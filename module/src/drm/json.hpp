// drm/json -- minimal dependency-free JSON parser plus the canonical
// serializer required by DRM Protocol v2 (PLAN G-001/G-006).
//
// The server signs the lease over "canonical JSON": recursively key-sorted
// object members, no whitespace, JS JSON.stringify-compatible string
// escaping, and the top-level "signature" member removed. The C++ client
// must reproduce those exact bytes to verify lease signatures, so the
// canonical dumper here mirrors the server implementation in
// mta-market-site (apps/server/src/lib/artifact/crypto.ts):
//   1. drop the "signature" member of the root object;
//   2. sort object keys by byte order (all protocol keys are ASCII, which
//      matches the server's UTF-16 code-unit sort);
//   3. compact output: no spaces between tokens;
//   4. strings escape ", \ and control bytes exactly like JSON.stringify
//      (\b \f \n \r \t shorthands, otherwise \u00xx with lowercase hex).
// Numbers are preserved as their original token text so the client never
// re-formats a server-provided number (e.g. "2" stays "2", never "2.0").

#pragma once

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace mta::drm
{

class Json
{
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    /// Object members keep insertion order; canonical output sorts them.
    using Members = std::vector<std::pair<std::string, Json>>;

    Type type = Type::Null;
    bool boolean = false;
    std::string number;                    // raw token, preserved verbatim
    std::string string_value;
    std::vector<Json> array;
    Members object;

    static Json make_null();
    static Json make_bool(bool value);
    static Json make_number(std::string_view token);
    static Json make_string(std::string value);
    static Json make_array();
    static Json make_object();

    const Json *find(std::string_view key) const;

    /// Parses a complete JSON document. Returns nullopt on any malformed
    /// input (trailing garbage is rejected).
    static std::optional<Json> parse(std::string_view text);

    /// Canonical serialization (PLAN G-001): if strip_signature is set, the
    /// root object's "signature" member is excluded (lease verification).
    std::string canonical(bool strip_signature = false) const;

    /// Compact serialization preserving member order (no canonical sorting).
    std::string compact() const;
};

} // namespace mta::drm
