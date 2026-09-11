// Registry documentation generator: dumps every module
// function registered through MTA_FUNCTION/MTA_LUA_FUNCTION and every object
// type registered through MTA_OBJECT with its methods as readable markdown.
// Consumed by `mta docs`.
//
// The function specs are added by the registration macros' static
// initializers, so simply linking the module sources populates the registry.
// Object methods register lazily into a VM (MTA_METHOD runs inside the
// per-type registrar), so a scratch VM materializes the declared types here;
// their metadata is recorded compiler-independently at every MTA_METHOD call.
//
// Information that cannot be derived automatically is marked explicitly
//: the category of a module function (no registration spelling
// provides one yet), per-function error lists (not part of the signature
// metadata) and the methods of types declared without MTA_OBJECT
// (compiler-dependent identity, not listed).

#include "sdk/lua/common.hpp"
#include "sdk/objects/userdata.hpp"
#include "sdk/registry/registry.hpp"

#include <cstdint>
#include <cstdio>
#include <exception>
#include <string>
#include <vector>

namespace
{
std::string signature_text(const std::string &qualname, const mta::lua::Signature &signature)
{
    std::string text = qualname;
    text += "(";
    for (std::size_t i = 0; i < signature.arguments.size(); ++i)
    {
        if (i != 0)
        {
            text += ", ";
        }
        text += signature.arguments[i].type;
        if (signature.arguments[i].optional)
        {
            text += "?";
        }
    }
    text += ")";
    if (signature.variadic)
    {
        text += " (variadic)";
    }
    if (!signature.returns.empty())
    {
        text += " -> ";
        for (std::size_t i = 0; i < signature.returns.size(); ++i)
        {
            if (i != 0)
            {
                text += ", ";
            }
            text += signature.returns[i];
        }
    }
    return text;
}

std::string flags_text(std::uint32_t flags)
{
    if (flags == 0)
    {
        return "none";
    }
    std::string text;
    const auto append = [&text](const char *flag) {
        if (!text.empty())
        {
            text += ", ";
        }
        text += flag;
    };
    if ((flags & mta::lua::function_flag_variadic) != 0)
    {
        append("variadic");
    }
    if ((flags & mta::lua::function_flag_callback) != 0)
    {
        append("callback");
    }
    return text;
}

// The metadata block shared by module functions and object methods (plan
// metadata): argument types with optional markers, return types, category,
// flags -- and explicit markers for everything not derivable.
void print_call_metadata(const mta::lua::Signature &signature, const char *category,
                         std::uint32_t flags)
{
    if (!signature.derived)
    {
        std::printf("- arguments: n/a (signature not derived)\n");
        std::printf("- returns: n/a (signature not derived)\n");
    }
    else if (signature.arguments.empty())
    {
        std::printf("- arguments: none\n");
    }
    else
    {
        std::printf("- arguments:\n");
        for (std::size_t i = 0; i < signature.arguments.size(); ++i)
        {
            std::printf("    - #%zu %s%s\n", i + 1, signature.arguments[i].type.c_str(),
                        signature.arguments[i].optional ? " (optional)" : "");
        }
    }
    if (signature.derived)
    {
        if (signature.returns.empty())
        {
            std::printf("- returns: nothing\n");
        }
        else
        {
            std::printf("- returns:");
            for (const auto &type : signature.returns)
            {
                std::printf(" %s", type.c_str());
            }
            std::printf("\n");
        }
    }
    if (category != nullptr && *category != '\0')
    {
        std::printf("- category: %s\n", category);
    }
    else
    {
        std::printf("- category: n/a (no registration spelling provides it yet)\n");
    }
    std::printf("- flags: %s\n", flags_text(flags).c_str());
    std::printf("- errors: n/a (raised errors are not part of the signature metadata; the binder "
                "converts them to Lua errors)\n");
}

void print_function(const mta::registry::Spec &fn)
{
    std::printf("## %s\n\n", fn.name);

    if (fn.description != nullptr && *fn.description != '\0')
    {
        std::printf("%s\n\n", fn.description);
    }
    else
    {
        std::printf("_(no description)_\n\n");
    }

    if (!fn.signature.derived)
    {
        std::printf("```\n%s(...)\n```\n\n", fn.name);
        std::printf("Signature not derived: body-style registration reads its arguments "
                    "itself.\n\n");
    }
    else
    {
        std::printf("```\n%s\n```\n\n", signature_text(fn.name, fn.signature).c_str());
        if (fn.signature.variadic)
        {
            std::printf("Accepts trailing arguments.\n\n");
        }
    }

    print_call_metadata(fn.signature, fn.category.c_str(), fn.flags);
    std::printf("\n");
}
} // namespace

int main()
{
    const auto &functions = mta::registry::Registry::instance().functions();
    const auto &objects = mta::userdata::object_types();
    if (functions.empty() && objects.empty())
    {
        std::printf("no functions registered\n");
        return 1;
    }

    std::printf("# Module functions\n\n");
    std::printf("%zu function(s) registered through MTA_FUNCTION.\n\n", functions.size());
    for (const auto &fn : functions)
    {
        print_function(fn);
    }

    // Object methods: registered through MTA_METHOD into per-type
    // metatables, so a scratch VM materializes the declared types first. The
    // vendored Lua is MTA's patched 5.1: luaL_newstate takes the state's
    // owner (mtasaowner) -- nullptr for a module-owned state.
    std::printf("# Object types\n\n");
    if (objects.empty())
    {
        std::printf("No object types registered through MTA_OBJECT. Types without an explicit "
                    "MTA_OBJECT name are not listed (their identity would be "
                    "compiler-dependent).\n\n");
        return 0;
    }

    std::printf("%zu object type(s) registered through MTA_OBJECT.\n\n", objects.size());
    lua_State *scratch = luaL_newstate(nullptr);
    if (scratch == nullptr)
    {
        std::printf("_(object methods unavailable: the scratch VM could not be created)_\n\n");
        return 0;
    }

    for (const auto &object : objects)
    {
        try
        {
            object.materialize(scratch);
        }
        catch (const std::exception &e)
        {
            std::printf("## %s\n\n_(methods unavailable: %s)_\n\n", object.type.c_str(), e.what());
            continue;
        }

        std::printf("## %s\n\n", object.type.c_str());
        const std::vector<mta::userdata::MethodInfo> &methods = object.methods();
        if (methods.empty())
        {
            std::printf("_(no methods registered)_\n\n");
            continue;
        }
        for (const auto &method : methods)
        {
            const std::string qualname = object.type + ":" + method.name;
            std::printf("### %s\n\n", qualname.c_str());
            std::printf("_(no description: MTA_METHOD does not carry one)_\n\n");
            std::printf("```\n%s\n```\n\n", signature_text(qualname, method.signature).c_str());
            // The object type groups the method (category).
            print_call_metadata(method.signature, object.type.c_str(), method.signature.flags);
            std::printf("\n");
        }
    }
    lua_close(scratch);
    return 0;
}