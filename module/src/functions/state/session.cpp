// Per-resource state: a hit counter for the calling resource. It resets
// automatically when the resource stops (ResourceStopped).

#include <mta/sdk.hpp>

namespace
{
struct Session
{
    int hits = 0;
};

mta::resources::Store<Session> g_sessions;
} // namespace

MTA_LUA_FUNCTION("sample_session_hit",
    "Hit counter for the calling resource; resets when the resource stops.")
{
    Session &session = g_sessions.for_state(L);
    ++session.hits;
    return mta::lua::push_results(L, static_cast<lua_Number>(session.hits));
}