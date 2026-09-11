// The plan-style facade: <mta/sdk.hpp> + MTA_FUNCTION with a lambda.
// The function registers under exactly the given name -- no prefixes.

#include <mta/sdk.hpp>

#include <string>
#include <tuple>

MTA_FUNCTION("sample_hello",
    [](std::string name)
    {
        return "Hello, " + name;
    });

// The described form: MTA_FUNCTION(name, "description", function).
MTA_FUNCTION("sample_hello_desc", "Greets politely.",
    [](std::string name)
    {
        return "Good evening, " + name;
    });

// Tuple result: two values at once; the signature metadata (module_signature)
// is derived from this lambda.
MTA_FUNCTION("sample_hello_len", "Greets and reports the name length.",
    [](std::string name)
    {
        return std::make_tuple("Hello, " + name, static_cast<int>(name.size()));
    });