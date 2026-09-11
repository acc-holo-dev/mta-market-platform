// drm/http_client -- minimal authenticated HTTPS client (PLAN H-002).
//
// Requirements implemented here (plan H-002):
// - HTTPS only (OpenSSL TLS, TLS 1.2+);
// - certificate validation enabled by default against the system trust
//   store; a self-signed override exists but is an explicit opt-in
//   (allow_self_signed) for local development;
// - connect and read/write timeouts via socket options and non-blocking
//   handshake deadline;
// - bounded retry policy: at most `max_attempts` attempts (default 3) with a
//   short linear backoff -- never an infinite retry loop;
// - hard response size limit (default 1 MiB);
// - HTTP status validation: statuses >= 400 are surfaced as an error that
//   carries the status code and body;
// - secure headers: User-Agent, Accept, Content-Type (JSON), Connection close;
// - cancellation: an abort flag consulted between phases.
//
// Scope note: this is a deliberately small client for the DRM machine API
// (JSON request/response, no streaming, no chunked encoding) -- exactly the
// "one minimal authenticated HTTP client" the plan asks for.

#pragma once

#include <atomic>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace mta::drm
{

struct HttpRequest
{
    std::string host;
    std::uint16_t port = 443;
    std::string target;             // e.g. /drm/v2/activate
    std::string method = "GET";     // GET or POST
    std::map<std::string, std::string> headers;
    std::string body;               // empty for GET

    /// Serializes the request exactly as it goes on the wire (testable).
    std::string serialize() const;
};

struct HttpResponse
{
    int status = 0;
    std::string body;
};

struct HttpClientError
{
    enum class Kind {
        Aborted,
        Dns,
        Connect,
        Tls,
        Io,
        Protocol,   // malformed HTTP response
        Status,     // HTTP >= 400 (see status + body)
        TooLarge,
        Timeout,
    };
    Kind kind;
    int status = 0;        // meaningful for Kind::Status
    std::string message;
};

class HttpClient
{
public:
    struct Options
    {
        Options() = default;
        int connect_timeout_seconds = 10;
        int io_timeout_seconds = 15;
        int max_attempts = 3;
        std::size_t max_response_bytes = 1024 * 1024;
        /// Dev-only override; MUST stay false in production builds.
        bool allow_self_signed = false;
    };

    explicit HttpClient(std::atomic<bool> *abort_flag = nullptr);
    explicit HttpClient(std::atomic<bool> *abort_flag, Options options);

    /// Performs an HTTPS request with bounded retries. On success returns
    /// the response; on failure returns the last error.
    std::optional<HttpResponse> send(const HttpRequest &request, HttpClientError &error);

    /// Formats a request for the wire (exposed for tests).
    static std::string serialize_request(const HttpRequest &request);

private:
    std::optional<HttpResponse> attempt(const HttpRequest &request, HttpClientError &error);

    std::atomic<bool> *abort_flag_;
    Options options_;
};

} // namespace mta::drm
