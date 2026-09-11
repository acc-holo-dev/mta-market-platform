-- Scheduler stress test: 1000 async tasks at once.

local count = 0
for i = 1, 1000 do
    sample_async_add(i, 1, function(sum)
        count = count + 1
    end)
end

test_pump(3000)
test_assert(count == 1000, "all 1000 async tasks completed")
