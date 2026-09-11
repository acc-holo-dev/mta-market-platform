#pragma once

// Borrowed state view -- the LuaView half of the value model.
//
// mta::state wraps the CURRENT lua_State for synchronous operations: reading
// typed arguments, pushing results, asking which resource owns the VM. It
// never owns the VM and must never be cached or moved across threads: a
// resource's VM dies when the resource stops and a restarted resource runs
// in a fresh VM. Values that travel across async boundaries use
// the owned Snapshot model instead (mta::lua::{Argument, Table, Arguments}).
//
//     MTA_FUNCTION("describe", "Describes the calling resource.")
//     {
//         mta::state s = MTA_STATE(L);
//         return mta::lua::push_results(L, s.resource_name());
//     }

#include "sdk/abi/module.hpp"
#include "sdk/bind/bind.hpp"
#include "sdk/lua/common.hpp"
#include "sdk/lua/stack.hpp"

#include <string>
#include <tuple>
#include <utility>

namespace mta
{
// Borrowed, non-owning view of a Lua 5.1 VM (LuaView).
class state
{
public:
    state() noexcept = default;

    // Wraps the VM a module function runs in -- usually spelled MTA_STATE(L).
    explicit state(lua_State *lua_vm) noexcept
        : lua_vm_(lua_vm)
    {
    }

    // The wrapped VM. Valid only for the current synchronous call: never
    // store the handle past the call, across threads, or into async work.
    [[nodiscard]] lua_State *handle() const noexcept { return lua_vm_; }

    // false for a default-constructed view (or a null VM).
    [[nodiscard]] bool valid() const noexcept { return lua_vm_ != nullptr; }
    explicit operator bool() const noexcept { return lua_vm_ != nullptr; }

    // Number of values currently on the stack.
    [[nodiscard]] int top() const noexcept { return lua_gettop(lua_vm_); }

    // The name of the resource owning this VM right now ("" when it cannot
    // be determined).
    [[nodiscard]] std::string resource_name() const noexcept
    {
        return mta::module::current_resource_name(lua_vm_);
    }

    // Typed argument readers -- the same conversions as mta::lua::args:
    //
    //     auto [a, b] = s.args<double, double>();
    template <typename... Ts>
    [[nodiscard]] std::tuple<Ts...> args() const
    {
        return mta::lua::args<Ts...>(lua_vm_);
    }

    // Pushes one or more results -- the same conversions as
    // mta::lua::push_results; returns how many were pushed.
    template <typename... Values>
    int push_results(Values &&...values) const
    {
        return mta::lua::push_results(lua_vm_, std::forward<Values>(values)...);
    }

    // Number of call arguments (values on the stack).
    [[nodiscard]] int arg_count() const noexcept { return lua_gettop(lua_vm_); }

    // Typed argument readers (the LuaView is the synchronous read
    // surface) -- the same conversions and error messages as the free
    // mta::lua::check_*/opt_* helpers in sdk/lua/stack.hpp. Indices follow
    // Lua conventions: 1-based, negatives count from the top.
    [[nodiscard]] double check_number(int index) const { return mta::lua::check_number(lua_vm_, index); }
    [[nodiscard]] double opt_number(int index, double default_value) const
    {
        return mta::lua::opt_number(lua_vm_, index, default_value);
    }
    [[nodiscard]] lua_Integer check_integer(int index) const
    {
        return mta::lua::check_integer(lua_vm_, index);
    }
    [[nodiscard]] lua_Integer opt_integer(int index, lua_Integer default_value) const
    {
        return mta::lua::opt_integer(lua_vm_, index, default_value);
    }
    [[nodiscard]] bool check_boolean(int index) const { return mta::lua::check_boolean(lua_vm_, index); }
    [[nodiscard]] bool opt_boolean(int index, bool default_value) const
    {
        return mta::lua::opt_boolean(lua_vm_, index, default_value);
    }
    [[nodiscard]] std::string check_string(int index) const { return mta::lua::check_string(lua_vm_, index); }
    [[nodiscard]] std::string opt_string(int index, const char *default_value) const
    {
        return mta::lua::opt_string(lua_vm_, index, default_value);
    }

private:
    lua_State *lua_vm_ = nullptr;
};
} // namespace mta

// The borrowed model is also spelled "LuaView": mta::LuaView is the same type
// as mta::state (the facade name), kept as an alias so both vocabularies work.
namespace mta
{
using LuaView = state;
} // namespace mta

// The calling VM as a state view: expression form, name the view
// yourself. The view is borrowed -- it dies with the call:
//
//     mta::state s = MTA_STATE(L);
#define MTA_STATE(LuaVm) (::mta::state{(LuaVm)})