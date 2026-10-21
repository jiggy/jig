# Mac allocation before durable child ownership

Mac owner planning creates its directory before the caller records the durable child cleanup allocation.
Coordinator loss during that interval can leave an unrecorded directory.
The Linux planner does not create that directory during planning.

Separate inert allocation planning from resource creation, or journal the allocation before creating native state.
Preserve directory identity checks, authenticated recovery, exclusive ownership and rejection of substituted state.
Cover real coordinator loss during allocation, before sealing and before the durable child record commits.
Require zero leftover resources after recovery without weakening admitted-child cleanup assertions.

The checkpoint lifecycle suite observes both child handlers before its selected crash barrier.
It proves admitted-child recovery and does not cover this earlier allocation interval.
