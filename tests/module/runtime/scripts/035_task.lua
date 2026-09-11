-- Task handle: run/cancel via the samples, resource
-- ownership of queued tasks.

-- a cancellable task
local ok, task_id = pcall(sample_task_run, 40, 2, 3, function(sum) TASK_RESULT = sum end)
test_assert(ok and task_id > 0, "sample_task_run returns a task id")

-- cancel BEFORE the completion: the callback must never fire
test_assert(sample_task_cancel(task_id) == true, "queued task accepts cancellation")
TASK_RESULT = nil
test_pump(150)
test_assert(TASK_RESULT == nil, "cancelled task never delivered its completion")

-- a task that is not cancelled delivers on the main thread
TASK_RESULT = nil
local ok2, id2 = pcall(sample_task_run, 1, 10, 20, function(sum) TASK_RESULT = sum end)
test_assert(ok2 and id2 > 0, "second task posted")
test_pump(150)
test_assert(TASK_RESULT == 30, "uncancelled task delivered its result")

-- cancelling an unknown id reports false
test_assert(sample_task_cancel(999999) == false, "cancelling an unknown id returns false")

-- resource ownership: a queued task of this resource is cancelled
-- by a stop; its completion never runs
TASK_RESULT = nil
local ok3, id3 = pcall(sample_task_run, 60, 5, 5, function(sum) TASK_RESULT = sum end)
test_resource_stop()
test_pump(250)
test_assert(TASK_RESULT == nil, "task completion dropped after resource stop")
test_resource_start()

-- the resource works normally again afterwards
test_assert(sample_add(2, 3) == 5, "module functions work after the stop/start cycle")