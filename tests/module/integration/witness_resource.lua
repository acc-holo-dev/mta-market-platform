-- Witness resource for the multi-resource scenarios.
--
-- Installed by other/server/mta_server.py as "sdkintegration2", next to the
-- main suite resource ("sdkintegration"). It auto-starts, never restarts,
-- and verifies that two resources run side by side with fully isolated
-- per-resource module state while the main resource performs its whole
-- stop/start/restart choreography.

local MARK = "INTEGRATION:"
local failures = {}

local function check(name, condition)
    if condition then
        outputServerLog(MARK .. " SCENARIO " .. name .. ": PASS")
    else
        failures[#failures + 1] = name
        outputServerLog(MARK .. " SCENARIO " .. name .. ": FAIL")
    end
end

setTimer(function()
    -- multiple-resources scenario: this resource has its own VM (its own
    -- registered functions, its own per-resource state) while the main
    -- resource runs its scenarios next door. sample_session_hit() must
    -- start from 1 here: the main resource already used its own session
    -- store (two hits in its generation 1), so a shared/global store would
    -- report 3.
    local firstHit = sample_session_hit()
    check("multiple resources",
        type(sample_add) == "function"
        and sample_resource_name() == "sdkintegration2"
        and sample_resource_find("sdkintegration") == true
        and firstHit == 1
        and sample_add(20, 22) == 42)
end, 800, 1)

-- Late witness: after the main resource's stop/start/restart choreography,
-- multi-resource coexistence must still hold (the main resource is in its
-- third generation by now).
setTimer(function()
    if sample_resource_find("sdkintegration") == true and type(sample_add) == "function" then
        outputServerLog(MARK .. " witness: multi-resource coexistence held for the whole run")
    else
        failures[#failures + 1] = "multiple resources"
        outputServerLog(MARK .. " SCENARIO multiple resources: FAIL")
    end
end, 20000, 1)