#include "sdk/registry/registry.hpp"

#include "ILuaModuleManager10.h"
#include "sdk/logging/logging.hpp"

namespace mta::registry
{
Registry &Registry::instance()
{
    static Registry registry;
    return registry;
}

void Registry::add(const Spec &spec)
{
    functions_.push_back(spec);
}

void Registry::register_all(ILuaModuleManager10 &manager, lua_State *lua_vm) const
{
    if (lua_vm == nullptr)
    {
        return;
    }

    for (const auto &spec : functions_)
    {
        // module_function and lua_CFunction share the same ABI on every
        // supported toolchain; the cast only switches the language linkage.
        const bool registered =
            manager.RegisterFunction(lua_vm, spec.name, reinterpret_cast<lua_CFunction>(spec.function));
        if (!registered)
        {
            mta::log::error("module: failed to register function '", spec.name, "'");
        }
    }
}
} // namespace mta::registry

namespace mta::lua::detail
{
// Bridge from the binder into the registry; implemented here so bind.hpp
// does not drag the registry internals along.
bool register_function(const char *name, const char *description, int (*entry)(lua_State *),
                       const Signature &signature)
{
    if (name == nullptr || entry == nullptr)
    {
        return false;
    }
    mta::registry::Spec spec{name, description, entry};
    spec.signature = signature;
    // The capability flags were derived together with the signature
    //; the descriptor keeps its own copy for inspection.
    spec.flags = signature.flags;
    mta::registry::Registry::instance().add(std::move(spec));
    return true;
}
} // namespace mta::lua::detail
