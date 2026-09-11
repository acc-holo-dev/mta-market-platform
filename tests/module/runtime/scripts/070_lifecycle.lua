-- Lifecycle: per-resource state resets when the resource stops.

test_assert(sample_session_hit() == 1, "first hit")
test_assert(sample_session_hit() == 2, "second hit")

-- simulate a resource stop (ResourceStopping + ResourceStopped)
test_resource_stop()

-- state was reset: the counter starts from one again
test_assert(sample_session_hit() == 1, "state reset after resource stop")

-- simulate a resource restart (functions re-registered)
test_resource_start()
test_assert(sample_session_hit() == 2, "state persists after restart")
