// drm/market_client -- the module side of the MTA Market server integration
// (PLAN-005 workstream AC: ownership verification, review token, online
// status, minimum server heartbeat -- explicitly NOT a telemetry platform).
//
// Wire protocol (mta-market-site/apps/server/src/routes/integration.ts):
//   POST /integration/heartbeat      { token, state?, players?, maxPlayers? }
//     -> { status, monitoring, verification }
//   POST /integration/review-tokens  { token, note?, ttlMinutes? }
//     -> { reviewToken, expiresAt }
//
// Privacy rules (PLAN-005 §33): the client reports ONLY aggregate data --
// online player count, max players and its own status. It never sends
// player identity, IP addresses, chat or movement data.
//
// Proof-of-control (C-001): MTA Market issues the integration token (smk_...);
// the server owner configures it here; possession of the secret proves
// control of the game server and flips the market-side verification to
// VERIFIED after the first valid heartbeat.
//
// Threading: heartbeat() and requestReviewToken() are blocking network calls
// intended for worker threads (mta::async::run) or the dedicated heartbeat
// thread started by startHeartbeat(). All shared state is atomic/mutex-guarded.

#pragma once

#include <drm/http_client.hpp>
#include <drm/json.hpp>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace mta::drm
{

struct MarketClientConfig
{
    std::string base_url;      // e.g. https://market.example.com (https only)
    std::string server_token;  // integration token issued by MTA Market (smk_...)
    /// Dev-only TLS override; leave false in production.
    bool allow_self_signed = false;
};

struct HeartbeatState
{
    std::string monitoring;  // ONLINE / OFFLINE / UNKNOWN (server view)
    std::string verification; // PENDING / VERIFIED / FAILED / EXPIRED
    bool ok = false;
    std::string error;
};

class MarketClient
{
public:
    explicit MarketClient(MarketClientConfig config, std::atomic<bool> *abort_flag = nullptr);

    /// One heartbeat. `players` is the current online count, `max_players`
    /// the slot limit. state ONLINE by default; OFFLINE when the server
    /// gracefully shuts down (the only OFFLINE source; silent gaps degrade
    /// to UNKNOWN on the market side).
    std::optional<Json> heartbeat(int players, int max_players, const std::string &state,
                                  HttpClientError &error);

    /// Requests a one-time review token for a player (J-002). The plaintext
    /// token is handed to the caller exactly once; the server keeps only its
    /// hash. Server-bound + expiring + single-use.
    std::optional<Json> requestReviewToken(const std::string &note, int ttl_minutes,
                                           HttpClientError &error);

    /// Minimum server heartbeat: starts a background thread that performs a
    /// heartbeat every interval. The player counts come from the atomics fed
    /// by mta_market_report_players. Returns false when already running.
    bool startHeartbeat(int interval_seconds);

    /// Stops the heartbeat thread (idempotent).
    void stopHeartbeat();

    bool heartbeatRunning() const { return heartbeat_running_; }

    /// Last heartbeat result, readable from any thread (main thread UX).
    HeartbeatState lastState() const;

    void setPlayers(int players, int max_players);

private:
    std::optional<Json> post(const std::string &target, const std::string &body,
                             HttpClientError &error);

    void runLoop();

    MarketClientConfig config_;
    std::atomic<bool> *abort_flag_;
    std::mutex config_mutex_;

    std::atomic<bool> heartbeat_running_{false};
    std::atomic<bool> stop_requested_{false};
    std::thread heartbeat_thread_;
    std::mutex heartbeat_cv_mutex_;
    std::condition_variable heartbeat_cv_;

    std::atomic<int> players_{-1};  // -1 = not reported yet
    std::atomic<int> max_players_{0};
    std::atomic<int> interval_seconds_{60};

    // Last heartbeat outcome (mutex: two std::strings).
    mutable std::mutex state_mutex_;
    HeartbeatState state_;
};

} // namespace mta::drm