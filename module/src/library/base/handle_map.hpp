#pragma once

// Reusable layer: small, module-agnostic utilities that several
// functions can share. This header does not depend on the SDK and never
// touches Lua -- code here is plain C++ that a module function may call.

#include <cstddef>
#include <optional>
#include <unordered_map>
#include <utility>

namespace mta::library::base
{
// Numeric-id -> handle registry with the emplace/find/erase flow module
// functions need when they hand handles to Lua (async task ids, timer
// ids). Keyed by id; lookups return pointers into the map (main-thread
// use, like everything holding live handles).
template <typename Id, typename Handle>
class HandleMap final
{
public:
    // Inserts the handle under id. Returns false when the id is already
    // taken (the caller decides whether that is an error).
    bool emplace(Id id, Handle handle)
    {
        return map_.emplace(id, std::move(handle)).second;
    }

    // The live handle or nullptr.
    [[nodiscard]] Handle *find(Id id) noexcept
    {
        const auto it = map_.find(id);
        return it == map_.end() ? nullptr : &it->second;
    }

    [[nodiscard]] const Handle *find(Id id) const noexcept
    {
        const auto it = map_.find(id);
        return it == map_.end() ? nullptr : &it->second;
    }

    // True when the id existed and was erased.
    bool erase(Id id)
    {
        return map_.erase(id) > 0;
    }

    // Whether the id is currently registered.
    [[nodiscard]] bool contains(Id id) const noexcept
    {
        return map_.find(id) != map_.end();
    }

    [[nodiscard]] std::size_t size() const noexcept { return map_.size(); }
    void clear() noexcept { map_.clear(); }

private:
    std::unordered_map<Id, Handle> map_{};
};
} // namespace mta::library::base