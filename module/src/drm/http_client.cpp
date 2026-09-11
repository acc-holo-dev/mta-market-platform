#include <drm/http_client.hpp>

#include <netdb.h>
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <cctype>
#include <cerrno>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <thread>

namespace mta::drm
{
namespace
{

void set_socket_timeout(int fd, int seconds)
{
    timeval timeout{};
    timeout.tv_sec = seconds;
    timeout.tv_usec = 0;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
}

bool aborted(std::atomic<bool> *flag)
{
    return flag != nullptr && flag->load();
}

std::string openssl_errors()
{
    std::string message;
    while (const unsigned long code = ERR_get_error())
    {
        char buffer[256] = {0};
        ERR_error_string_n(code, buffer, sizeof(buffer));
        if (!message.empty())
            message += "; ";
        message += buffer;
    }
    return message;
}

} // namespace

std::string HttpClient::serialize_request(const HttpRequest &request)
{
    std::string out;
    out.reserve(256 + request.body.size());
    out += request.method + " " + request.target + " HTTP/1.1\r\n";
    out += "Host: " + request.host + "\r\n";
    out += "User-Agent: mta-market-module\r\n";
    out += "Accept: application/json\r\n";
    if (!request.body.empty())
    {
        out += "Content-Type: application/json\r\n";
        out += "Content-Length: " + std::to_string(request.body.size()) + "\r\n";
    }
    for (const auto &[name, value] : request.headers)
        out += name + ": " + value + "\r\n";
    out += "Connection: close\r\n";
    out += "\r\n";
    out += request.body;
    return out;
}

HttpClient::HttpClient(std::atomic<bool> *abort_flag)
    : HttpClient(abort_flag, Options{})
{
}

HttpClient::HttpClient(std::atomic<bool> *abort_flag, Options options)
    : abort_flag_(abort_flag), options_(std::move(options))
{
    static bool ssl_initialized = []() {
        SSL_library_init();
        SSL_load_error_strings();
        return true;
    }();
    (void)ssl_initialized;
}

std::optional<HttpResponse> HttpClient::attempt(const HttpRequest &request, HttpClientError &error)
{
    if (aborted(abort_flag_))
    {
        error = {HttpClientError::Kind::Aborted, 0, "aborted before request"};
        return std::nullopt;
    }

    // ---- DNS + TCP connect with timeout ----
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_protocol = IPPROTO_TCP;
    addrinfo *address_list = nullptr;
    if (getaddrinfo(request.host.c_str(), std::to_string(request.port).c_str(), &hints,
                    &address_list) != 0 ||
        address_list == nullptr)
    {
        error = {HttpClientError::Kind::Dns, 0, "DNS resolution failed for " + request.host};
        return std::nullopt;
    }
    struct AddressListDeleter
    {
        void operator()(addrinfo *list) const
        {
            if (list != nullptr)
                freeaddrinfo(list);
        }
    };
    std::unique_ptr<addrinfo, AddressListDeleter> addresses(address_list);

    int fd = -1;
    for (const addrinfo *address = addresses.get(); address != nullptr; address = address->ai_next)
    {
        fd = socket(address->ai_family, address->ai_socktype, address->ai_protocol);
        if (fd < 0)
            continue;
        set_socket_timeout(fd, options_.connect_timeout_seconds);
        if (connect(fd, address->ai_addr, address->ai_addrlen) == 0)
            break;
        close(fd);
        fd = -1;
    }
    if (fd < 0)
    {
        error = {HttpClientError::Kind::Connect, 0, "TCP connect failed/timed out"};
        return std::nullopt;
    }
    struct FdGuard
    {
        int fd;
        ~FdGuard()
        {
            if (fd >= 0)
                close(fd);
        }
    } fd_guard{fd};
    set_socket_timeout(fd, options_.io_timeout_seconds);

    // ---- TLS ----
    SSL_CTX *raw_ctx = SSL_CTX_new(TLS_client_method());
    if (!raw_ctx)
    {
        error = {HttpClientError::Kind::Tls, 0, "SSL_CTX allocation failed: " + openssl_errors()};
        return std::nullopt;
    }
    struct SslContextDeleter
    {
        void operator()(SSL_CTX *ctx) const { SSL_CTX_free(ctx); }
    };
    std::unique_ptr<SSL_CTX, SslContextDeleter> ssl_ctx(raw_ctx);

    SSL_CTX_set_min_proto_version(ssl_ctx.get(), TLS1_2_VERSION);
    if (options_.allow_self_signed)
    {
        // Explicit dev opt-in only (see header).
        SSL_CTX_set_verify(ssl_ctx.get(), SSL_VERIFY_NONE, nullptr);
    }
    else
    {
        SSL_CTX_set_verify(ssl_ctx.get(), SSL_VERIFY_PEER, nullptr);
        if (SSL_CTX_set_default_verify_paths(ssl_ctx.get()) != 1)
        {
            error = {HttpClientError::Kind::Tls, 0,
                     "failed to load system trust store: " + openssl_errors()};
            return std::nullopt;
        }
    }

    SSL *raw_ssl = SSL_new(ssl_ctx.get());
    if (!raw_ssl)
    {
        error = {HttpClientError::Kind::Tls, 0, "SSL allocation failed: " + openssl_errors()};
        return std::nullopt;
    }
    struct SslDeleter
    {
        void operator()(SSL *ssl) const { SSL_free(ssl); }
    };
    std::unique_ptr<SSL, SslDeleter> ssl(raw_ssl);
    SSL_set_fd(ssl.get(), fd);
    SSL_set_tlsext_host_name(ssl.get(), request.host.c_str());
    SSL_set1_host(ssl.get(), request.host.c_str()); // hostname verification

    if (SSL_connect(ssl.get()) != 1)
    {
        error = {HttpClientError::Kind::Tls, 0, "TLS handshake failed: " + openssl_errors()};
        return std::nullopt;
    }

    // ---- Send ----
    const std::string wire = serialize_request(request);
    std::size_t sent = 0;
    while (sent < wire.size())
    {
        if (aborted(abort_flag_))
        {
            error = {HttpClientError::Kind::Aborted, 0, "aborted during send"};
            return std::nullopt;
        }
        const int written = SSL_write(ssl.get(), wire.data() + sent,
                                      static_cast<int>(wire.size() - sent));
        if (written <= 0)
        {
            error = {HttpClientError::Kind::Io, 0, "send failed: " + openssl_errors()};
            return std::nullopt;
        }
        sent += static_cast<std::size_t>(written);
    }

    // ---- Receive with a hard response size cap ----
    std::string response;
    response.reserve(4096);
    char buffer[8192];
    while (true)
    {
        if (aborted(abort_flag_))
        {
            error = {HttpClientError::Kind::Aborted, 0, "aborted during receive"};
            return std::nullopt;
        }
        const int received = SSL_read(ssl.get(), buffer, sizeof(buffer));
        if (received < 0)
        {
            error = {HttpClientError::Kind::Io, 0, "receive failed: " + openssl_errors()};
            return std::nullopt;
        }
        if (received == 0)
            break; // clean shutdown (Connection: close)
        response.append(buffer, static_cast<std::size_t>(received));
        if (response.size() > options_.max_response_bytes)
        {
            error = {HttpClientError::Kind::TooLarge, 0, "response exceeds size limit"};
            return std::nullopt;
        }
    }

    // ---- Parse status line + headers + body ----
    const std::size_t header_end = response.find("\r\n\r\n");
    if (header_end == std::string::npos)
    {
        error = {HttpClientError::Kind::Protocol, 0, "malformed HTTP response (no header terminator)"};
        return std::nullopt;
    }
    const std::string head = response.substr(0, header_end);
    std::string body = response.substr(header_end + 4);

    std::size_t line_end = head.find("\r\n");
    const std::string status_line = line_end == std::string::npos ? head : head.substr(0, line_end);
    // "HTTP/1.1 200 OK"
    const std::size_t first_space = status_line.find(' ');
    const std::size_t second_space = status_line.find(' ', first_space + 1);
    if (first_space == std::string::npos || second_space == std::string::npos)
    {
        error = {HttpClientError::Kind::Protocol, 0, "malformed HTTP status line"};
        return std::nullopt;
    }
    const int status = std::atoi(status_line.c_str() + first_space + 1);

    // Fold chunked transfer coding if the server used it despite Connection: close.
    bool chunked = false;
    std::string headers_lower = head;
    for (char &c : headers_lower)
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (headers_lower.find("transfer-encoding: chunked") != std::string::npos)
        chunked = true;

    if (chunked)
    {
        std::string decoded;
        std::size_t offset = 0;
        while (offset < body.size())
        {
            const std::size_t line_break = body.find("\r\n", offset);
            if (line_break == std::string::npos)
                break;
            const std::size_t chunk_size = std::strtoul(body.substr(offset, line_break - offset).c_str(),
                                                        nullptr, 16);
            if (chunk_size == 0)
                break;
            const std::size_t start = line_break + 2;
            if (start + chunk_size > body.size())
            {
                error = {HttpClientError::Kind::Protocol, 0, "truncated chunked body"};
                return std::nullopt;
            }
            decoded.append(body, start, chunk_size);
            offset = start + chunk_size + 2; // skip trailing CRLF
        }
        body = decoded;
    }

    if (status >= 400)
    {
        error = {HttpClientError::Kind::Status, status,
                 "HTTP " + std::to_string(status) + ": " + body};
        return std::nullopt;
    }

    HttpResponse result;
    result.status = status;
    result.body = body;
    return result;
}

std::optional<HttpResponse> HttpClient::send(const HttpRequest &request, HttpClientError &error)
{
    for (int attempt_number = 1; attempt_number <= options_.max_attempts; ++attempt_number)
    {
        if (aborted(abort_flag_))
        {
            error = {HttpClientError::Kind::Aborted, 0, "aborted"};
            return std::nullopt;
        }
        auto result = attempt(request, error);
        if (result.has_value())
            return result;
        // Retry only transport-level failures; server verdicts are final.
        if (error.kind != HttpClientError::Kind::Connect &&
            error.kind != HttpClientError::Kind::Io && error.kind != HttpClientError::Kind::Tls &&
            error.kind != HttpClientError::Kind::Dns &&
            error.kind != HttpClientError::Kind::Timeout)
            return std::nullopt;
        if (attempt_number < options_.max_attempts)
            std::this_thread::sleep_for(std::chrono::milliseconds(250 * attempt_number));
    }
    return std::nullopt;
}

} // namespace mta::drm
