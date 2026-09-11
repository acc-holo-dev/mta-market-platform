// functions/drm/market -- Lua surface of the MTA Market server integration
// (PLAN-005 workstream AC). The owner's server resource configures the
// integration once and reports player counts; the module keeps the market
// informed with a minimum heartbeat and can request one-time review tokens.
//
//     mta_market_configure("https://market.example.com", "smk_...")
//     mta_market_start()
//     mta_market_report_players(getPlayerCount(), getMaxPlayers())
//     mta_market_review_token(function(token, err) ... end)
//
// Privacy (PLAN-005 §33): only aggregate counts cross the wire -- never
// player identity, IP or chat. Verified means ownership verified, nothing
// else (C-002).

#include <mta/sdk.hpp>

#include <drm/market_client.hpp>
#include <drm/json.hpp>

#include <memory>
#include <mutex>
#include <string>
#include <utility>

using mta::drm::Json;

namespace
{

// Shared ownership: an in-flight review-token task keeps its client alive
// even if Lua reconfigures the integration mid-request.
std::mutex g_market_mutex;
std::shared_ptr<mta::drm::MarketClient> g_market;

} // namespace

MTA_LUA_FUNCTION("mta_market_configure",
    "Configures the MTA Market integration. "
    "mta_market_configure(base_url, server_token). "
    "Returns true on acceptance.")
{
    auto [base_url, server_token] = mta::lua::args<std::string, std::string>(L);

    if (base_url.rfind("https://", 0) != 0)
    {
        mta::lua::raise_error("base_url must start with https://");
    }

    std::lock_guard<std::mutex> lock(g_market_mutex);
    // Reconfiguration restarts the client; a running heartbeat is stopped.
    if (g_market && g_market->heartbeatRunning())
        g_market->stopHeartbeat();
    mta::drm::MarketClientConfig config;
    config.base_url = base_url;
    config.server_token = server_token;
    g_market = std::make_shared<mta::drm::MarketClient>(std::move(config));
    return mta::lua::push_results(L, true);
}

MTA_LUA_FUNCTION("mta_market_start",
    "Starts the minimum heartbeat: the module reports its status and online "
    "count every mta_market_report_players interval (default 60s). "
    "Returns true when the heartbeat thread was started.")
{
    std::lock_guard<std::mutex> lock(g_market_mutex);
    if (!g_market)
    {
        mta::lua::raise_error("MTA Market integration is not configured");
    }
    const bool started = g_market->heartbeatRunning()
        ? true
        : g_market->startHeartbeat(60);
    return mta::lua::push_results(L, started);
}

MTA_LUA_FUNCTION("mta_market_stop",
    "Stops the heartbeat thread. true when a running heartbeat was stopped.")
{
    std::lock_guard<std::mutex> lock(g_market_mutex);
    if (!g_market || !g_market->heartbeatRunning())
    {
        return mta::lua::push_results(L, false);
    }
    g_market->stopHeartbeat();
    return mta::lua::push_results(L, true);
}

MTA_LUA_FUNCTION("mta_market_report_players",
    "Feeds the heartbeat with the current online count. "
    "Call on onPlayerJoin/onPlayerQuit: mta_market_report_players(getPlayerCount(), getMaxPlayers()).")
{
    auto [players, max_players] = mta::lua::args<std::int64_t, std::int64_t>(L);

    std::lock_guard<std::mutex> lock(g_market_mutex);
    if (!g_market)
    {
        return mta::lua::push_results(L, false);
    }
    g_market->setPlayers(static_cast<int>(players), static_cast<int>(max_players));
    return mta::lua::push_results(L, true);
}

MTA_LUA_FUNCTION("mta_market_status",
    "Returns the last heartbeat outcome as 'ok|error|idle|monitoring|verification' or 'idle' "
    "before the first heartbeat.")
{
    std::lock_guard<std::mutex> lock(g_market_mutex);
    if (!g_market)
    {
        return mta::lua::push_results(L, "idle");
    }
    const auto state = g_market->lastState();
    if (!state.ok)
    {
        return mta::lua::push_results(L, "error: " + state.error);
    }
    return mta::lua::push_results(L, "ok:" + state.monitoring + ":" + state.verification);
}

MTA_LUA_FUNCTION("mta_market_review_token",
    "Requests a one-time review token (PLAN-005 J-002) and calls "
    "callback(review_token) on success or callback(nil, error) on failure. "
    "Hand the token to the player in-game; they enter it on MTA Market to gain "
    "review eligibility. Non-blocking: the HTTP call runs on a worker.")
{
    auto [note, callback] = mta::lua::args<std::string, mta::async::Callback>(L);
    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));

    std::shared_ptr<mta::drm::MarketClient> client = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_market_mutex);
        client = g_market;
    }
    if (client == nullptr)
    {
        mta::lua::raise_error("MTA Market integration is not configured");
    }

    mta::async::Task task = mta::async::run(
        L,
        [client, note]() -> mta::lua::Arguments {
            mta::drm::HttpClientError error;
            auto response = client->requestReviewToken(note, 0, error);
            mta::lua::Arguments result;
            if (!response)
            {
                result.push_nil();
                result.push_string(error.message);
                return result;
            }
            const Json *token = response->find("reviewToken");
            if (token == nullptr || token->type != Json::Type::String)
            {
                result.push_nil();
                result.push_string("unexpected market response");
                return result;
            }
            result.push_string(token->string_value);
            return result;
        },
        [cb](const mta::lua::Arguments &result, const char *error) {
            if (error != nullptr)
            {
                mta::log::error("mta_market_review_token failed: ", error);
                return;
            }
            cb->call(result);
        });

    if (!task.valid())
    {
        mta::lua::raise_error("task queue is full: review token request not accepted");
    }
    return mta::lua::push_results(L, true);
}