const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(cors());

app.use(express.json());


// ==========================================
// IN-MEMORY STORAGE
// ==========================================

const bookingQueue = [];

const schedulingDecisions = [];

const activeLocks = [];

let leaseSequence = 0;

let decisionSequence = 0;

const schedulingMetrics = {
    scheduling_runs: 0,
    policy_run_counts: {
        FCFS: 0,
        PRIORITY: 0,
        "EARLIEST-FIT": 0,
        "URGENCY-WEIGHTED": 0
    },
    lock_acquire_attempts: 0,
    lock_acquire_grants: 0,
    lock_conflicts: 0,
    deadlock_detections: 0
};


// ==========================================
// PROVIDER SLOTS
// ==========================================

const providerSlots = {

    PROV001: [

        {
            slot_id: "PROV001-09:00",
            start: "09:00",
            end: "09:30"
        },

        {
            slot_id: "PROV001-09:30",
            start: "09:30",
            end: "10:00"
        },

        {
            slot_id: "PROV001-10:00",
            start: "10:00",
            end: "10:30"
        },

        {
            slot_id: "PROV001-10:30",
            start: "10:30",
            end: "11:00"
        },

        {
            slot_id: "PROV001-11:00",
            start: "11:00",
            end: "11:30"
        },

        {
            slot_id: "PROV001-11:30",
            start: "11:30",
            end: "12:00"
        },

        {
            slot_id: "PROV001-12:00",
            start: "12:00",
            end: "12:30"
        },

        {
            slot_id: "PROV001-12:30",
            start: "12:30",
            end: "13:00"
        }

    ],

    PROV002: [

        {
            slot_id: "PROV002-09:00",
            start: "09:00",
            end: "09:30"
        },

        {
            slot_id: "PROV002-09:30",
            start: "09:30",
            end: "10:00"
        },

        {
            slot_id: "PROV002-10:00",
            start: "10:00",
            end: "10:30"
        },

        {
            slot_id: "PROV002-10:30",
            start: "10:30",
            end: "11:00"
        },

        {
            slot_id: "PROV002-11:00",
            start: "11:00",
            end: "11:30"
        },

        {
            slot_id: "PROV002-11:30",
            start: "11:30",
            end: "12:00"
        },

        {
            slot_id: "PROV002-12:00",
            start: "12:00",
            end: "12:30"
        },

        {
            slot_id: "PROV002-12:30",
            start: "12:30",
            end: "13:00"
        }

    ],

    PROV003: [

        {
            slot_id: "PROV003-09:00",
            start: "09:00",
            end: "09:30"
        },

        {
            slot_id: "PROV003-09:30",
            start: "09:30",
            end: "10:00"
        },

        {
            slot_id: "PROV003-10:00",
            start: "10:00",
            end: "10:30"
        },

        {
            slot_id: "PROV003-10:30",
            start: "10:30",
            end: "11:00"
        },

        {
            slot_id: "PROV003-11:00",
            start: "11:00",
            end: "11:30"
        },

        {
            slot_id: "PROV003-11:30",
            start: "11:30",
            end: "12:00"
        },

        {
            slot_id: "PROV003-12:00",
            start: "12:00",
            end: "12:30"
        },

        {
            slot_id: "PROV003-12:30",
            start: "12:30",
            end: "13:00"
        }

    ]

};


// ==========================================
// PRIORITY VALUE
// ==========================================

function getPriorityValue(priority) {

    if (priority === "HIGH") {
        return 3;
    }

    if (priority === "MEDIUM") {
        return 2;
    }

    if (priority === "LOW") {
        return 1;
    }

    return 1;
}


// ==========================================
// QUEUE ORDERING
// ==========================================

function getProviderBookings(providerId) {

    return bookingQueue
        .filter(
            booking =>
                booking.provider_id === providerId
        );
}


function orderFCFS(providerBookings) {

    return [...providerBookings].sort(
        (a, b) =>
            new Date(a.submitted_at) -
            new Date(b.submitted_at)
    );
}


function orderPriority(providerBookings) {

    return [...providerBookings].sort(
        (a, b) => {

            const priorityDifference =
                getPriorityValue(b.priority) -
                getPriorityValue(a.priority);

            if (priorityDifference !== 0) {
                return priorityDifference;
            }

            return (
                new Date(a.submitted_at) -
                new Date(b.submitted_at)
            );

        }
    );
}


function orderUrgencyWeighted(providerBookings) {

    const currentTime =
        Date.now();


    return providerBookings
        .map(
            booking => {

                const submittedTime =
                    new Date(
                        booking.submitted_at
                    ).getTime();


                const waitingMinutes =
                    Math.max(
                        0,
                        (
                            currentTime -
                            submittedTime
                        ) /
                        (1000 * 60)
                    );


                const urgencyScore =
                    getPriorityValue(
                        booking.priority
                    ) * 10 +
                    waitingMinutes;


                return {
                    booking,
                    urgencyScore
                };

            }
        )
        .sort(
            (a, b) =>
                b.urgencyScore -
                a.urgencyScore
        )
        .map(
            item => ({
                ...item.booking,
                urgency_score:
                    Math.round(
                        item.urgencyScore * 100
                    ) / 100
            })
        );
}


function orderBookings(providerId, policy) {

    const providerBookings =
        getProviderBookings(providerId);

    if (policy === "PRIORITY") {
        return orderPriority(providerBookings);
    }

    if (policy === "URGENCY-WEIGHTED") {
        return orderUrgencyWeighted(providerBookings);
    }

    return orderFCFS(providerBookings);

}


function createQueueView(bookings, policy) {

    return bookings.map(
        (booking, index) => ({
            ...booking,
            queue_position: index + 1,
            accepted_policy: policy
        })
    );

}


// ==========================================
// TIME CONVERSION
// ==========================================

function timeToMinutes(time) {

    const parts =
        time.split(":");

    return (
        Number(parts[0]) * 60 +
        Number(parts[1])
    );
}


function minutesToTime(totalMinutes) {

    const hours =
        Math.floor(totalMinutes / 60);

    const minutes =
        totalMinutes % 60;

    return (
        String(hours).padStart(2, "0") +
        ":" +
        String(minutes).padStart(2, "0")
    );
}


// ==========================================
// CHECK ACTIVE LOCK
// ==========================================

function removeExpiredLocks() {

    const currentTime =
        Date.now();

    const expiredLeaseIds = new Set();

    for (
        let i = activeLocks.length - 1;
        i >= 0;
        i--
    ) {

        const lock =
            activeLocks[i];

        if (
            new Date(lock.expires_at).getTime() <=
            currentTime
        ) {

            expiredLeaseIds.add(lock.lease_id);
            activeLocks.splice(i, 1);

        }

    }

    expiredLeaseIds.forEach(
        leaseId => {
            clearBookingScheduleForLease(leaseId);
        }
    );

}


function clearBookingScheduleForLease(leaseId) {

    const booking =
        bookingQueue.find(
            item =>
                item.lease_id === leaseId
        );

    if (!booking) {
        return;
    }

    booking.state = "WAITLISTED";
    booking.assigned_slot_id = null;
    booking.assigned_slot_ids = [];
    booking.lease_id = null;
    booking.estimated_start = null;
    booking.scheduled_end = null;

}


// ==========================================
// FIND LOCK
// ==========================================

function findActiveLock(slotId) {

    removeExpiredLocks();

    return activeLocks.find(
        lock =>
            lock.slot_id === slotId
    );

}


// ==========================================
// INTERNAL LOCK ACQUIRE
// ==========================================

function acquireLockInternal(
    slotId,
    holderId,
    lockMode = "EXCLUSIVE",
    leaseTimeout = 30000,
    sharedLeaseId = null
) {

    schedulingMetrics.lock_acquire_attempts += 1;

    removeExpiredLocks();

    const existingLock =
        findActiveLock(slotId);

    // Same holder already owns the lock
    if (
        existingLock &&
        existingLock.holder_id === holderId
    ) {

        schedulingMetrics.lock_acquire_grants += 1;

        return {
            lock_granted: true,
            lease_id:
                existingLock.lease_id,
            slot_id:
                slotId,
            holder_id:
                holderId,
            lock_mode:
                existingLock.lock_mode,
            expires_at:
                existingLock.expires_at,
            conflict_reason:
                null,
            already_owned:
                true
        };

    }


    // Another holder owns the slot
    if (existingLock) {

        schedulingMetrics.lock_conflicts += 1;

        return {
            lock_granted: false,
            lease_id:
                null,
            slot_id:
                slotId,
            holder_id:
                holderId,
            lock_mode:
                lockMode,
            expires_at:
                null,
            conflict_reason:
                "Slot is already locked",
            existing_holder:
                existingLock.holder_id
        };

    }


    const leaseId =
        sharedLeaseId ||
        createLeaseId();

    const timeout =
        Number(leaseTimeout) || 30000;

    const expiresAt =
        new Date(
            Date.now() + timeout
        ).toISOString();


    const newLock = {

        lease_id:
            leaseId,

        slot_id:
            slotId,

        holder_id:
            holderId,

        lock_mode:
            lockMode,

        lease_timeout:
            timeout,

        acquired_at:
            new Date().toISOString(),

        expires_at:
            expiresAt

    };


    activeLocks.push(
        newLock
    );

    schedulingMetrics.lock_acquire_grants += 1;


    return {

        lock_granted:
            true,

        lease_id:
            leaseId,

        slot_id:
            slotId,

        holder_id:
            holderId,

        lock_mode:
            lockMode,

        expires_at:
            expiresAt,

        conflict_reason:
            null,

        already_owned:
            false

    };

}


function createLeaseId() {

    leaseSequence += 1;

    return `LEASE-${Date.now()}-${leaseSequence}`;

}


// ==========================================
// EARLIEST-FIT ALLOCATION
// ==========================================

function allocateEarliestFit(providerId, providerBookings) {

    removeExpiredLocks();

    const slots =
        providerSlots[providerId] || [];

    const slotDuration =
        slots.length > 0
            ? timeToMinutes(slots[0].end) -
              timeToMinutes(slots[0].start)
            : 0;


    providerBookings.forEach(
        (booking, index) => {

            booking.queue_position = index + 1;
            booking.accepted_policy = "EARLIEST-FIT";

            if (
                booking.state === "SCHEDULED" &&
                Array.isArray(booking.assigned_slot_ids) &&
                booking.assigned_slot_ids.length > 0 &&
                booking.assigned_slot_ids.every(
                    slotId => {
                        const lock = findActiveLock(slotId);
                        return (
                            lock &&
                            lock.holder_id === booking.request_id &&
                            lock.lease_id === booking.lease_id
                        );
                    }
                )
            ) {
                return;
            }

            booking.state = "WAITLISTED";
            booking.assigned_slot_id = null;
            booking.assigned_slot_ids = [];
            booking.lease_id = null;
            booking.estimated_start = null;
            booking.scheduled_end = null;

            const duration =
                Number(booking.duration_minutes);

            if (
                slotDuration <= 0 ||
                duration <= 0 ||
                duration % slotDuration !== 0
            ) {
                return;
            }

            const requiredSlots =
                duration / slotDuration;

            for (
                let startIndex = 0;
                startIndex <= slots.length - requiredSlots;
                startIndex++
            ) {

                const candidateSlots =
                    slots.slice(
                        startIndex,
                        startIndex + requiredSlots
                    );

                const contiguous =
                    candidateSlots.every(
                        (slot, slotIndex) =>
                            slotIndex === 0 ||
                            timeToMinutes(
                                candidateSlots[slotIndex - 1].end
                            ) === timeToMinutes(slot.start)
                    );

                if (!contiguous) {
                    continue;
                }

                const available =
                    candidateSlots.every(
                        slot => !findActiveLock(slot.slot_id)
                    );

                if (!available) {
                    continue;
                }

                const leaseId =
                    createLeaseId();

                const acquiredLocks =
                    candidateSlots.map(
                        slot =>
                            acquireLockInternal(
                                slot.slot_id,
                                booking.request_id,
                                "EXCLUSIVE",
                                30000,
                                leaseId
                            )
                    );

                if (
                    acquiredLocks.some(
                        lock => !lock.lock_granted
                    )
                ) {
                    for (
                        let lockIndex = activeLocks.length - 1;
                        lockIndex >= 0;
                        lockIndex--
                    ) {
                        if (
                            activeLocks[lockIndex].lease_id === leaseId
                        ) {
                            activeLocks.splice(lockIndex, 1);
                        }
                    }

                    continue;
                }

                booking.assigned_slot_ids =
                    candidateSlots.map(slot => slot.slot_id);

                booking.assigned_slot_id =
                    candidateSlots.length === 1
                        ? candidateSlots[0].slot_id
                        : `${candidateSlots[0].slot_id}..${candidateSlots[candidateSlots.length - 1].slot_id}`;

                booking.lease_id = leaseId;
                booking.estimated_start = candidateSlots[0].start;
                booking.scheduled_end =
                    candidateSlots[candidateSlots.length - 1].end;
                booking.state = "SCHEDULED";
                break;
            }

        }
    );

    return providerBookings;
}


// ==========================================
// CREATE SCHEDULING DECISION
// ==========================================

function createDecisionId() {

    decisionSequence += 1;

    return `DEC-${Date.now()}-${decisionSequence}`;

}


function createSchedulingDecision(
    booking,
    policy
) {

    const decisionId =
        createDecisionId();


    const decision = {

        decision_id:
            decisionId,

        request_id:
            booking.request_id,

        selected_request:
            booking.request_id,

        provider_id:
            booking.provider_id,

        assigned_slot_id:
            booking.assigned_slot_id || null,

        scheduled_start:
            booking.estimated_start ||
            null,

        scheduled_end:
            booking.scheduled_end ||
            null,

        state:
            booking.state,

        lease_id:
            booking.lease_id || null,

        accepted_policy:
            policy,

        algorithm_version:
            "Team-A-Scheduler-v1.0",

        decision_metrics: {

            queue_position:
                booking.queue_position,

            priority:
                booking.priority,

            duration_minutes:
                booking.duration_minutes,

            urgency_score:
                booking.urgency_score ||
                null

        },

        correlation_id:
            booking.correlation_id,

        created_at:
            new Date().toISOString()

    };


    schedulingDecisions.push(
        decision
    );


    booking.decision_id =
        decisionId;


    return decision;

}


// ==========================================
// CREATE NEW BOOKING
// ==========================================

app.post(
    "/api/v1/scheduling/requests",
    (req, res) => {

        const {

            request_id,

            user_id,

            provider_id,

            service_type,

            duration_minutes,

            priority,

            preferred_window

        } = req.body;


        // Validation
        if (
            !request_id ||
            !user_id ||
            !provider_id ||
            !service_type ||
            !duration_minutes ||
            !priority
        ) {

            return res.status(400).json({

                error: {

                    message:
                        "Missing required booking fields"

                }

            });

        }


        // Idempotency check
        const existingBooking =
            bookingQueue.find(
                booking =>
                    booking.request_id ===
                    request_id
            );


        if (existingBooking) {

            return res.status(200).json({

                message:
                    "Booking already exists",

                data:
                    existingBooking

            });

        }


        // Create booking
        const booking = {

            request_id,

            user_id,

            provider_id,

            service_type,

            duration_minutes:
                Number(duration_minutes),

            priority,

            preferred_window:
                preferred_window ||
                null,

            submitted_at:
                new Date().toISOString(),

            queue_position:
                getProviderBookings(provider_id).length + 1,

            state:
                "QUEUED",

            accepted_policy:
                "FCFS",

            assigned_slot_id:
                null,

            assigned_slot_ids:
                [],

            lease_id:
                null,

            estimated_start:
                null,

            scheduled_end:
                null,

            decision_id:
                null,

            correlation_id:
                "CORR-" +
                Date.now()

        };


        bookingQueue.push(
            booking
        );


        return res.status(201).json({

            message:
                "Booking created successfully",

            data:
                booking

        });

    }
);


// ==========================================
// GET PROVIDER QUEUE
// ==========================================

app.get(
    "/api/v1/providers/:providerId/queue",
    (req, res) => {

        const providerId =
            req.params.providerId;

        const policy =
            req.query.policy ||
            "FCFS";


        const orderedBookings =
            orderBookings(providerId, policy);

        const queue =
            createQueueView(orderedBookings, policy);


        return res.json({

            provider_id:
                providerId,

            policy:
                policy,

            count:
                queue.length,

            data:
                queue

        });

    }
);


// ==========================================
// GET BOOKING BY REQUEST ID
// ==========================================

app.get(
    "/api/v1/scheduling/requests/:requestId",
    (req, res) => {

        const requestId =
            req.params.requestId;


        const booking =
            bookingQueue.find(
                b =>
                    b.request_id ===
                    requestId
            );


        if (!booking) {

            return res.status(404).json({

                error: {

                    message:
                        "Booking not found"

                }

            });

        }


        return res.json({

            data:
                booking

        });

    }
);


// ==========================================
// RUN SCHEDULER
// ==========================================

app.post(
    "/internal/v1/scheduler/run",
    (req, res) => {

        const {

            provider_id,

            policy

        } = req.body;


        if (
            !provider_id ||
            !policy
        ) {

            return res.status(400).json({

                error: {

                    message:
                        "provider_id and policy are required"

                }

            });

        }


        const supportedPolicies = [
            "FCFS",
            "PRIORITY",
            "EARLIEST-FIT",
            "URGENCY-WEIGHTED"
        ];

        if (!supportedPolicies.includes(policy)) {

            return res.status(400).json({

                error: {

                    message:
                        "Unsupported scheduling policy"

                }

            });

        }

        const orderedBookings =
            orderBookings(provider_id, policy);

        const result =
            orderedBookings.map(
                orderedBooking =>
                    bookingQueue.find(
                        booking =>
                            booking.request_id ===
                            orderedBooking.request_id
                    )
            );

        result.forEach(
            (booking, index) => {
                booking.queue_position = index + 1;
                booking.accepted_policy = policy;

                if (policy === "URGENCY-WEIGHTED") {
                    booking.urgency_score =
                        orderedBookings[index].urgency_score;
                }
            }
        );

        if (policy === "EARLIEST-FIT") {
            allocateEarliestFit(provider_id, result);
        }

        schedulingMetrics.scheduling_runs += 1;
        schedulingMetrics.policy_run_counts[policy] += 1;

        // Create scheduling decisions
        const decisions = [];


        result.forEach(
            booking => {

                const decision =
                    createSchedulingDecision(
                        booking,
                        policy
                    );


                decisions.push(
                    decision
                );


            }
        );


        return res.json({

            message:
                "Scheduler executed successfully",

            provider_id:
                provider_id,

            policy:
                policy,

            scheduled_count:
                result.filter(
                    booking =>
                        booking.state ===
                        "SCHEDULED"
                ).length,

            queue_count:
                result.length,

            decision_count:
                decisions.length,

            data:
                result,

            decisions:
                decisions

        });

    }
);


// ==========================================
// GET SCHEDULING DECISION
// ==========================================

app.get(
    "/api/v1/scheduling/decisions/:decisionId",
    (req, res) => {

        const decisionId =
            req.params.decisionId;


        const decision =
            schedulingDecisions.find(
                d =>
                    d.decision_id ===
                    decisionId
            );


        if (!decision) {

            return res.status(404).json({

                error: {

                    message:
                        "Scheduling decision not found"

                }

            });

        }


        return res.json({

            data:
                decision

        });

    }
);


// ==========================================
// GET RUNTIME SCHEDULING METRICS
// ==========================================

app.get(
    "/api/v1/metrics/scheduling",
    (req, res) => {

        const stateCounts = {};
        const queueDepth = {};

        bookingQueue.forEach(
            booking => {
                stateCounts[booking.state] =
                    (stateCounts[booking.state] || 0) + 1;

                if (!queueDepth[booking.provider_id]) {
                    queueDepth[booking.provider_id] = 0;
                }

                if (
                    booking.state === "QUEUED" ||
                    booking.state === "WAITLISTED"
                ) {
                    queueDepth[booking.provider_id] += 1;
                }
            }
        );

        const scheduledCount =
            stateCounts.SCHEDULED || 0;

        const waitlistedCount =
            stateCounts.WAITLISTED || 0;

        removeExpiredLocks();

        return res.json({
            success: true,
            data: {
                total_requests: bookingQueue.length,
                state_counts: stateCounts,
                queue_depth: queueDepth,
                scheduled_count: scheduledCount,
                waitlisted_count: waitlistedCount,
                scheduling_runs:
                    schedulingMetrics.scheduling_runs,
                policy_run_counts:
                    { ...schedulingMetrics.policy_run_counts },
                lock_acquire_attempts:
                    schedulingMetrics.lock_acquire_attempts,
                lock_acquire_grants:
                    schedulingMetrics.lock_acquire_grants,
                lock_conflicts:
                    schedulingMetrics.lock_conflicts,
                active_locks: activeLocks.length,
                deadlock_detections:
                    schedulingMetrics.deadlock_detections
            }
        });

    }
);


// ==========================================
// DEADLOCK CYCLE DETECTION
// ==========================================

function findDeadlockCycle(waitForEdges) {

    const graph = new Map();

    waitForEdges.forEach(
        edge => {
            if (!graph.has(edge.waiting_holder_id)) {
                graph.set(edge.waiting_holder_id, []);
            }

            if (!graph.has(edge.blocking_holder_id)) {
                graph.set(edge.blocking_holder_id, []);
            }

            graph
                .get(edge.waiting_holder_id)
                .push(edge.blocking_holder_id);
        }
    );

    const visited = new Set();
    const activePath = [];
    const activePathIndexes = new Map();

    function visit(holderId) {

        visited.add(holderId);
        activePathIndexes.set(holderId, activePath.length);
        activePath.push(holderId);

        for (const blockingHolderId of graph.get(holderId) || []) {

            if (activePathIndexes.has(blockingHolderId)) {
                const cycleStart =
                    activePathIndexes.get(blockingHolderId);

                return [
                    ...activePath.slice(cycleStart),
                    blockingHolderId
                ];
            }

            if (!visited.has(blockingHolderId)) {
                const cycle = visit(blockingHolderId);

                if (cycle) {
                    return cycle;
                }
            }

        }

        activePath.pop();
        activePathIndexes.delete(holderId);

        return null;

    }

    // DFS tracks the active path; an edge back to that path forms a cycle.
    for (const holderId of graph.keys()) {
        if (!visited.has(holderId)) {
            const cycle = visit(holderId);

            if (cycle) {
                return cycle;
            }
        }
    }

    return null;

}


// ==========================================
// ANALYSE WAIT-FOR GRAPH
// ==========================================

app.post(
    "/internal/v1/deadlocks/analyse",
    (req, res) => {

        const waitForEdges =
            req.body && req.body.wait_for_edges;

        if (!Array.isArray(waitForEdges)) {
            return res.status(400).json({
                error: {
                    message: "wait_for_edges must be an array"
                }
            });
        }

        const normalizedEdges = [];

        for (let index = 0; index < waitForEdges.length; index++) {
            const edge = waitForEdges[index];

            if (
                !edge ||
                typeof edge.waiting_holder_id !== "string" ||
                !edge.waiting_holder_id.trim() ||
                typeof edge.blocking_holder_id !== "string" ||
                !edge.blocking_holder_id.trim()
            ) {
                return res.status(400).json({
                    error: {
                        message:
                            `wait_for_edges[${index}] must contain non-empty waiting_holder_id and blocking_holder_id strings`
                    }
                });
            }

            normalizedEdges.push({
                waiting_holder_id:
                    edge.waiting_holder_id.trim(),
                blocking_holder_id:
                    edge.blocking_holder_id.trim()
            });
        }

        const deadlockCycle =
            findDeadlockCycle(normalizedEdges);

        const deadlockDetected =
            deadlockCycle !== null;

        if (deadlockDetected) {
            schedulingMetrics.deadlock_detections += 1;
        }

        return res.json({
            deadlock_detected:
                deadlockDetected,
            deadlock_cycle:
                deadlockCycle || [],
            prevention_or_recovery_action:
                deadlockDetected
                    ? "ABORT_LOW_PRIORITY_REQUEST"
                    : "NONE_REQUIRED"
        });

    }
);


// ==========================================
// ACQUIRE SLOT LOCK
// ==========================================

app.post(
    "/internal/v1/locks/acquire",
    (req, res) => {

        const {

            slot_id,

            holder_id,

            lock_mode,

            lease_timeout

        } = req.body;


        if (
            !slot_id ||
            !holder_id
        ) {

            return res.status(400).json({

                error: {

                    message:
                        "slot_id and holder_id are required"

                }

            });

        }


        const result =
            acquireLockInternal(

                slot_id,

                holder_id,

                lock_mode ||
                    "EXCLUSIVE",

                lease_timeout ||
                    30000

            );


        if (
            !result.lock_granted
        ) {

            return res.status(409).json({

                data:
                    result

            });

        }


        return res.status(201).json({

            data:
                result

        });

    }
);


// ==========================================
// RELEASE SLOT LOCK
// ==========================================

app.delete(
    "/internal/v1/locks/:leaseId",
    (req, res) => {

        const leaseId =
            req.params.leaseId;


        removeExpiredLocks();


        const lockIndex =
            activeLocks.findIndex(
                lock =>
                    lock.lease_id ===
                    leaseId
            );


        if (
            lockIndex === -1
        ) {

            return res.status(404).json({

                error: {

                    message:
                        "Lease not found or already expired"

                }

            });

        }


        const releasedLock = activeLocks[lockIndex];
        const releasedLeaseId = releasedLock.lease_id;

        for (
            let index = activeLocks.length - 1;
            index >= 0;
            index--
        ) {
            if (activeLocks[index].lease_id === releasedLeaseId) {
                activeLocks.splice(index, 1);
            }
        }

        clearBookingScheduleForLease(releasedLeaseId);


        return res.json({

            message:
                "Slot lock released successfully",

            data: {

                lease_id:
                    releasedLock.lease_id,

                slot_id:
                    releasedLock.slot_id,

                holder_id:
                    releasedLock.holder_id,

                lock_released:
                    true

            }

        });

    }
);


// ==========================================
// VIEW ACTIVE LOCKS
// ==========================================

app.get(
    "/internal/v1/locks",
    (req, res) => {

        removeExpiredLocks();


        return res.json({

            count:
                activeLocks.length,

            data:
                activeLocks

        });

    }
);


// ==========================================
// HEALTH CHECK
// ==========================================

app.get(
    "/",
    (req, res) => {

        res.json({

            message:
                "Team A Scheduling Engine is running",

            status:
                "OK"

        });

    }
);


// ==========================================
// START SERVER
// ==========================================

app.listen(
    PORT,
    () => {

        console.log(
            `Team A Scheduling Engine running on http://localhost:${PORT}`
        );

    }
);