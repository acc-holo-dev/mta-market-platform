#include <drm/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <stdexcept>

namespace mta::drm
{
namespace
{

void escape_string(const std::string &value, std::string &out)
{
    out.push_back('"');
    for (const char raw : value)
    {
        const auto c = static_cast<unsigned char>(raw);
        switch (c)
        {
        case '"':
            out += "\\\"";
            break;
        case '\\':
            out += "\\\\";
            break;
        case '\b':
            out += "\\b";
            break;
        case '\f':
            out += "\\f";
            break;
        case '\n':
            out += "\\n";
            break;
        case '\r':
            out += "\\r";
            break;
        case '\t':
            out += "\\t";
            break;
        default:
            if (c < 0x20)
            {
                char buffer[7] = {0};
                std::snprintf(buffer, sizeof(buffer), "\\u%04x", c);
                out += buffer;
            }
            else
            {
                out.push_back(static_cast<char>(c));
            }
            break;
        }
    }
    out.push_back('"');
}

void dump_compact(const Json &value, std::string &out)
{
    switch (value.type)
    {
    case Json::Type::Null:
        out += "null";
        break;
    case Json::Type::Bool:
        out += value.boolean ? "true" : "false";
        break;
    case Json::Type::Number:
        out += value.number;
        break;
    case Json::Type::String:
        escape_string(value.string_value, out);
        break;
    case Json::Type::Array:
    {
        out.push_back('[');
        bool first = true;
        for (const Json &item : value.array)
        {
            if (!first)
                out.push_back(',');
            first = false;
            dump_compact(item, out);
        }
        out.push_back(']');
        break;
    }
    case Json::Type::Object:
    {
        out.push_back('{');
        bool first = true;
        for (const auto &[key, member] : value.object)
        {
            if (!first)
                out.push_back(',');
            first = false;
            escape_string(key, out);
            out.push_back(':');
            dump_compact(member, out);
        }
        out.push_back('}');
        break;
    }
    }
}

struct Parser
{
    std::string_view text;
    std::size_t position = 0;

    [[noreturn]] void fail(const char *message) const
    {
        throw std::runtime_error(message);
    }

    void skip_whitespace()
    {
        while (position < text.size())
        {
            const char c = text[position];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r')
                ++position;
            else
                break;
        }
    }

    char peek()
    {
        skip_whitespace();
        if (position >= text.size())
            fail("unexpected end of input");
        return text[position];
    }

    void expect(char c)
    {
        if (peek() != c)
            fail("unexpected character");
        ++position;
    }

    bool consume(char c)
    {
        if (position < text.size() && text[position] == c)
        {
            ++position;
            return true;
        }
        return false;
    }

    void literal(std::string_view word)
    {
        if (text.compare(position, word.size(), word) != 0)
            fail("invalid literal");
        position += word.size();
    }

    std::string parse_string()
    {
        expect('"');
        std::string out;
        while (position < text.size())
        {
            const char c = text[position++];
            if (c == '"')
                return out;
            if (static_cast<unsigned char>(c) < 0x20)
                fail("raw control character in string");
            if (c != '\\')
            {
                out.push_back(c);
                continue;
            }
            if (position >= text.size())
                fail("truncated escape");
            const char escape = text[position++];
            switch (escape)
            {
            case '"':
                out.push_back('"');
                break;
            case '\\':
                out.push_back('\\');
                break;
            case '/':
                out.push_back('/');
                break;
            case 'b':
                out.push_back('\b');
                break;
            case 'f':
                out.push_back('\f');
                break;
            case 'n':
                out.push_back('\n');
                break;
            case 'r':
                out.push_back('\r');
                break;
            case 't':
                out.push_back('\t');
                break;
            case 'u':
            {
                if (position + 4 > text.size())
                    fail("truncated \\u escape");
                unsigned code = 0;
                for (int i = 0; i < 4; ++i)
                {
                    const char hex = text[position++];
                    code <<= 4;
                    if (hex >= '0' && hex <= '9')
                        code |= static_cast<unsigned>(hex - '0');
                    else if (hex >= 'a' && hex <= 'f')
                        code |= static_cast<unsigned>(hex - 'a' + 10);
                    else if (hex >= 'A' && hex <= 'F')
                        code |= static_cast<unsigned>(hex - 'A' + 10);
                    else
                        fail("invalid \\u escape");
                }
                // Basic multilingual plane only: the DRM protocol payloads
                // are ASCII; surrogate pairs are decoded conservatively.
                if (code < 0x80)
                {
                    out.push_back(static_cast<char>(code));
                }
                else if (code < 0x800)
                {
                    out.push_back(static_cast<char>(0xC0 | (code >> 6)));
                    out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
                }
                else
                {
                    out.push_back(static_cast<char>(0xE0 | (code >> 12)));
                    out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
                    out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
                }
                break;
            }
            default:
                fail("invalid escape");
            }
        }
        fail("unterminated string");
    }

    std::string parse_number()
    {
        const std::size_t start = position;
        if (position < text.size() && (text[position] == '-' || text[position] == '+'))
            ++position;
        while (position < text.size() &&
               (std::isdigit(static_cast<unsigned char>(text[position])) || text[position] == '.' ||
                text[position] == 'e' || text[position] == 'E' || text[position] == '+' ||
                text[position] == '-'))
        {
            ++position;
        }
        if (position == start)
            fail("invalid number");
        return std::string(text.substr(start, position - start));
    }

    Json parse_value()
    {
        const char c = peek();
        if (c == '{')
            return parse_object();
        if (c == '[')
            return parse_array();
        if (c == '"')
        {
            Json value;
            value.type = Json::Type::String;
            value.string_value = parse_string();
            return value;
        }
        if (c == 't')
        {
            literal("true");
            return Json::make_bool(true);
        }
        if (c == 'f')
        {
            literal("false");
            return Json::make_bool(false);
        }
        if (c == 'n')
        {
            literal("null");
            return Json::make_null();
        }
        Json value;
        value.type = Json::Type::Number;
        value.number = parse_number();
        return value;
    }

    Json parse_array()
    {
        expect('[');
        Json value;
        value.type = Json::Type::Array;
        if (consume(']'))
            return value;
        while (true)
        {
            value.array.push_back(parse_value());
            if (consume(']'))
                return value;
            expect(',');
        }
    }

    Json parse_object()
    {
        expect('{');
        Json value;
        value.type = Json::Type::Object;
        if (consume('}'))
            return value;
        while (true)
        {
            const std::string key = parse_string();
            expect(':');
            value.object.emplace_back(key, parse_value());
            if (consume('}'))
                return value;
            expect(',');
        }
    }
};

void dump_canonical(const Json &value, std::string &out)
{
    switch (value.type)
    {
    case Json::Type::Object:
    {
        std::vector<std::pair<std::string, const Json *>> members;
        members.reserve(value.object.size());
        for (const auto &[key, member] : value.object)
            members.emplace_back(key, &member);
        std::sort(members.begin(), members.end(),
                  [](const auto &lhs, const auto &rhs) { return lhs.first < rhs.first; });
        out.push_back('{');
        bool first = true;
        for (const auto &[key, member] : members)
        {
            if (!first)
                out.push_back(',');
            first = false;
            escape_string(key, out);
            out.push_back(':');
            dump_canonical(*member, out);
        }
        out.push_back('}');
        break;
    }
    case Json::Type::Array:
    {
        out.push_back('[');
        bool first = true;
        for (const Json &item : value.array)
        {
            if (!first)
                out.push_back(',');
            first = false;
            dump_canonical(item, out);
        }
        out.push_back(']');
        break;
    }
    default:
        dump_compact(value, out);
        break;
    }
}

} // namespace

Json Json::make_null()
{
    Json value;
    value.type = Type::Null;
    return value;
}

Json Json::make_bool(bool value_bool)
{
    Json value;
    value.type = Type::Bool;
    value.boolean = value_bool;
    return value;
}

Json Json::make_number(std::string_view token)
{
    Json value;
    value.type = Type::Number;
    value.number = std::string(token);
    return value;
}

Json Json::make_string(std::string value_string)
{
    Json value;
    value.type = Type::String;
    value.string_value = std::move(value_string);
    return value;
}

Json Json::make_array()
{
    Json value;
    value.type = Type::Array;
    return value;
}

Json Json::make_object()
{
    Json value;
    value.type = Type::Object;
    return value;
}

const Json *Json::find(std::string_view key) const
{
    if (type != Type::Object)
        return nullptr;
    for (const auto &[member_key, member] : object)
    {
        if (member_key == key)
            return &member;
    }
    return nullptr;
}

std::optional<Json> Json::parse(std::string_view text)
{
    try
    {
        Parser parser{text, 0};
        Json value = parser.parse_value();
        parser.skip_whitespace();
        if (parser.position != text.size())
            return std::nullopt;
        return value;
    }
    catch (const std::runtime_error &)
    {
        return std::nullopt;
    }
}

std::string Json::canonical(bool strip_signature) const
{
    std::string out;
    if (strip_signature && type == Type::Object)
    {
        Json copy;
        copy.type = Type::Object;
        for (const auto &[key, member] : object)
        {
            if (key != "signature")
                copy.object.emplace_back(key, member);
        }
        dump_canonical(copy, out);
        return out;
    }
    dump_canonical(*this, out);
    return out;
}

std::string Json::compact() const
{
    std::string out;
    dump_compact(*this, out);
    return out;
}

} // namespace mta::drm
