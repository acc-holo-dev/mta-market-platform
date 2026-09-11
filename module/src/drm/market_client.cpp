// drm/market_client -- implementation of the MTA Market server integration
// client. See market_client.hpp for the protocol and privacy contract.
//
// The heartbeat loop is a deliberately small dedicated thread (sleep +
// blocking HttpClient with bounded retries and timeouts): no scheduler
// coupling, no timers bound to a Lua resource lifetime, and it keeps working
// even when the configuring resource finishes its startup. stopHeartbeat()
// is the explicit off-switch exposed to Lua.

#include "market_client.hpp"

namespace mta::drm
{

namespace
{

struct UrlParts
{
    std::string host;
    std::uint16_t port;
};

UrlParts split_url(const std::string &base_url)
{
    // Accepts https://host[:port]; http is rejected -- HTTPS only (H-002).
    // Local mirror of the license_client helper (same file-internal style).
    const std::string scheme = "https://";
    if (base_url.rfind(scheme, 0) != 0)
        return {};
    const std::string rest = base_url.substr(scheme.size());
    const std::size_t colon = rest.find(':');
    const std::size_t slash = rest.find('/');
    const std::string host = rest.substr(0, std::min(colon, slash) == std::string::npos
                                                 ? rest.size()
                                                 : std::min(colon, slash));
    std::uint16_t port = 443;
    if (colon != std::string::npos && (slash == std::string::npos || colon < slash))
    {
        port = static_cast<std::uint16_t>(std::atoi(rest.substr(colon + 1).c_str()));
    }
    return {host, port};
}

} // namespace

MarketClient::MarketClient(MarketClientConfig config, std::atomic<bool> *abort_flag)
    : config_(std::move(config)), abort_flag_(abort_flag)
{
}

std::optional<Json> MarketClient::post(const std::string &target, const std::string &body,
                                       HttpClientError &error)
{
    HttpClient::Options options;
    {
        std::lock_guard<std::mutex> lock(config_mutex_);
        options.allow_self_signed = config_.allow_self_signed;
    }
    HttpClient client{abort_flag_, options};

    HttpRequest request;
    UrlParts parts;
    {
        std::lock_guard<std::mutex> lock(config_mutex_);
        parts = split_url(config_.base_url);
    }
    if (parts.host.empty())
    {
        error = {HttpClientError::Kind::Protocol, 0, "base_url must be https://host[:port]"};
        return std::nullopt;
    }
    request.host = parts.host;
    request.port = parts.port;
    request.target = target;
    request.method = "POST";
    request.body = body;

    auto response = client.send(request, error);
    if (!response)
        return std::nullopt;
    return Json::parse(response->body);
}

std::optional<Json> MarketClient::heartbeat(int players, int max_players, const std::string &state,
                                            HttpClientError &error)
{
    std::string token;
    {
        std::lock_guard<std::mutex> lock(config_mutex_);
        token = config_.server_token;
    }
    if (token.empty())
    {
        error = {HttpClientError::Kind::Protocol, 0, "integration token is not configured"};
        return std::nullopt;
    }

    Json body = Json::make_object();
    body.object.emplace_back("token", Json::make_string(token));
    body.object.emplace_back("state", Json::make_string(state));
    body.object.emplace_back("players", Json::make_number(std::to_string(players)));
    body.object.emplace_back("maxPlayers", Json::make_number(std::to_string(max_players)));

    auto response = post("/integration/heartbeat", body.compact(), error);
    if (response)
    {
        HeartbeatState next;
        next.ok = true;
        if (const Json *m = response->find("monitoring"); m != nullptr && m->type == Json::Type::String)
            next.monitoring = m->string_value;
        if (const Json *v = response->find("verification"); v != nullptr && v->type == Json::Type::String)
            next.verification = v->string_value;
        std::lock_guard<std::mutex> lock(state_mutex_);
        state_ = next;
    }
    else
    {
        HeartbeatState next;
        next.ok = false;
        next.error = error.message;
        std::lock_guard<std::mutex> lock(state_mutex_);
        state_ = next;
    }
    return response;
}

std::optional<Json> MarketClient::requestReviewToken(const std::string &note, int ttl_minutes,
                                                     HttpClientError &error)
{
    std::string token;
    {
        std::lock_guard<std::mutex> lock(config_mutex_);
        token = config_.server_token;
    }
    if (token.empty())
    {
        error = {HttpClientError::Kind::Protocol, 0, "integration token is not configured"};
        return std::nullopt;
    }

    Json body = Json::make_object();
    body.object.emplace_back("token", Json::make_string(token));
    if (!note.empty())
        body.object.emplace_back("note", Json::make_string(note));
    if (ttl_minutes > 0)
        body.object.emplace_back("ttlMinutes", Json::make_number(std::to_string(ttl_minutes)));

    return post("/integration/review-tokens", body.compact(), error);
}

void MarketClient::setPlayers(int players, int max_players)
{
    players_ = players;
    max_players_ = max_players;
}

HeartbeatState MarketClient::lastState() const
{
    std::lock_guard<std::mutex> lock(state_mutex_);
    return state_;
}

bool MarketClient::startHeartbeat(int interval_seconds)
{
    if (heartbeat_running_)
        return false;
    if (interval_seconds > 0)
        interval_seconds_ = interval_seconds;
    stop_requested_ = false;
    heartbeat_running_ = true;
    heartbeat_thread_ = std::thread([this]() { runLoop(); });
    return true;
}

void MarketClient::stopHeartbeat()
{
    stop_requested_ = true;
    heartbeat_cv_.notify_all();
    if (heartbeat_thread_.joinable())
        heartbeat_thread_.join();
    heartbeat_running_ = false;
    stop_requested_ = false;
}

void MarketClient::runLoop()
{
    const int interval = interval_seconds_;
    auto next_deadline = std::chrono::steady_clock::now();
    while (!stop_requested_ && !(abort_flag_ != nullptr && abort_flag_->load()))
    {
        // Snapshot the reported counts (default 0/0 until Lua reports).
        int players = players_.load();
        if (players < 0)
            players = 0;
        int max_players = max_players_.load();

        HttpClientError error;
        heartbeat(players, max_players, "ONLINE", error);

        next_deadline += std::chrono::seconds(interval > 0 ? interval : 60);
        std::unique_lock<std::mutex> lock(heartbeat_cv_mutex_);
        heartbeat_cv_.wait_until(lock, next_deadline, [this]() { return stop_requested_.load(); });
    }
}

} // namespace mta::drm