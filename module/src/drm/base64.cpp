#include <drm/base64.hpp>

#include <array>

namespace mta::drm
{
namespace
{
constexpr std::string_view kAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

int alphabet_index(char c)
{
    if (c >= 'A' && c <= 'Z')
        return c - 'A';
    if (c >= 'a' && c <= 'z')
        return c - 'a' + 26;
    if (c >= '0' && c <= '9')
        return c - '0' + 52;
    if (c == '+')
        return 62;
    if (c == '/')
        return 63;
    return -1;
}
} // namespace

bool base64_decode(std::string_view input, std::vector<std::uint8_t> &out)
{
    out.clear();

    // Strip nothing: strict input. Only a well-formed padded quantum is OK.
    if (input.size() % 4 != 0 || input.empty())
    {
        return false;
    }

    out.reserve(input.size() / 4 * 3);
    std::array<int, 4> quad{};
    for (std::size_t i = 0; i < input.size(); i += 4)
    {
        int pad = 0;
        for (std::size_t j = 0; j < 4; ++j)
        {
            const char c = input[i + j];
            if (c == '=')
            {
                // '=' is only legal in the last one or two positions.
                if (i + 4 != input.size() || j < 2)
                {
                    out.clear();
                    return false;
                }
                quad[j] = 0;
                ++pad;
            }
            else
            {
                if (pad > 0)
                {
                    out.clear();
                    return false;
                }
                quad[j] = alphabet_index(c);
                if (quad[j] < 0)
                {
                    out.clear();
                    return false;
                }
            }
        }

        const std::uint32_t group = static_cast<std::uint32_t>((quad[0] << 18) | (quad[1] << 12) | (quad[2] << 6) | quad[3]);
        out.push_back(static_cast<std::uint8_t>((group >> 16) & 0xFF));
        if (pad < 2)
        {
            out.push_back(static_cast<std::uint8_t>((group >> 8) & 0xFF));
        }
        if (pad < 1)
        {
            out.push_back(static_cast<std::uint8_t>(group & 0xFF));
        }
    }
    return true;
}

std::vector<std::uint8_t> base64_decode(std::string_view input)
{
    std::vector<std::uint8_t> out;
    base64_decode(input, out);
    return out;
}

std::string base64_encode(const std::uint8_t *data, std::size_t size)
{
    std::string out;
    out.reserve((size + 2) / 3 * 4);

    std::size_t i = 0;
    while (i + 3 <= size)
    {
        const std::uint32_t group = (static_cast<std::uint32_t>(data[i]) << 16) | (static_cast<std::uint32_t>(data[i + 1]) << 8) | data[i + 2];
        out.push_back(kAlphabet[(group >> 18) & 0x3F]);
        out.push_back(kAlphabet[(group >> 12) & 0x3F]);
        out.push_back(kAlphabet[(group >> 6) & 0x3F]);
        out.push_back(kAlphabet[group & 0x3F]);
        i += 3;
    }

    const std::size_t rest = size - i;
    if (rest == 1)
    {
        const std::uint32_t group = static_cast<std::uint32_t>(data[i]) << 16;
        out.push_back(kAlphabet[(group >> 18) & 0x3F]);
        out.push_back(kAlphabet[(group >> 12) & 0x3F]);
        out.push_back('=');
        out.push_back('=');
    }
    else if (rest == 2)
    {
        const std::uint32_t group = (static_cast<std::uint32_t>(data[i]) << 16) | (static_cast<std::uint32_t>(data[i + 1]) << 8);
        out.push_back(kAlphabet[(group >> 18) & 0x3F]);
        out.push_back(kAlphabet[(group >> 12) & 0x3F]);
        out.push_back(kAlphabet[(group >> 6) & 0x3F]);
        out.push_back('=');
    }
    return out;
}

} // namespace mta::drm
