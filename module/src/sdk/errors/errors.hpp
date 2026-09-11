#pragma once

// Unified error model.
//
// Framework and module errors are C++ exceptions of one type carrying a
// category. Categories make failures diagnosable and distinguishable:
//
//   Generic          deliberate module error (raise_error in a function body)
//   InvalidArgument  argument count/order problem (binder)
//   InvalidType      argument type mismatch (binder)
//   MissingArgument  required argument absent (binder)
//   ResourceStopped  operation on a dead resource generation
//   InvalidCallback  stale or invalid Lua callback reference
//   InvalidObject    object of another type or another resource
//   AsyncCancelled   background task was cancelled
//   InternalError    framework bug / unexpected C++ exception
//
// The protected_call boundary renders InternalError distinctly
// ("internal module error: ...") so a framework bug can never masquerade as
// a scripter mistake. Every other category is rendered verbatim -- the
// producer of the error already wrote a user-facing message.

#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>

namespace mta::errors
{
enum class Category
{
    Generic,
    InvalidArgument,
    InvalidType,
    MissingArgument,
    ResourceStopped,
    InvalidCallback,
    InvalidObject,
    AsyncCancelled,
    InternalError,
};

class Error : public std::runtime_error
{
public:
    Error(Category category, std::string message)
        : std::runtime_error(message),
          category_(category)
    {
    }

    [[nodiscard]] Category category() const noexcept { return category_; }

private:
    Category category_;
};

// Raises an error of the given category.
[[noreturn]] inline void raise(Category category, std::string message)
{
    throw Error(category, std::move(message));
}

// Streaming variant: raise_error(Category::InvalidType, "bad argument #", 1, ...).
template <typename... Args>
[[noreturn]] void raise_error(Category category, Args &&...args)
{
    std::ostringstream stream;
    (stream << ... << std::forward<Args>(args));
    raise(category, stream.str());
}

// Human-readable category name (for logs and diagnostics).
inline const char *category_name(Category category) noexcept
{
    switch (category)
    {
    case Category::Generic: return "generic";
    case Category::InvalidArgument: return "invalid-argument";
    case Category::InvalidType: return "invalid-type";
    case Category::MissingArgument: return "missing-argument";
    case Category::ResourceStopped: return "resource-stopped";
    case Category::InvalidCallback: return "invalid-callback";
    case Category::InvalidObject: return "invalid-object";
    case Category::AsyncCancelled: return "async-cancelled";
    case Category::InternalError: return "internal-error";
    }
    return "unknown";
}
} // namespace mta::errors