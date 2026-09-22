use std::{
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};

/// Single-use rendezvous for native race fixtures. A failed peer must fail the
/// test, never strand a runtime worker or a process behind an unbounded wait.
pub(super) struct TestBarrier {
    parties: usize,
    state: Mutex<(usize, bool)>,
    changed: Condvar,
}

impl TestBarrier {
    pub(super) fn new(parties: usize) -> Self {
        Self {
            parties,
            state: Mutex::new((0, false)),
            changed: Condvar::new(),
        }
    }

    pub(super) fn wait(&self) {
        let mut state = self.state.lock().unwrap();
        state.0 += 1;
        self.changed.notify_all();
        let (mut state, _) = self
            .changed
            .wait_timeout_while(state, Duration::from_secs(5), |(arrived, broken)| {
                *arrived < self.parties && !*broken
            })
            .unwrap();
        let complete = state.0 == self.parties && !state.1;
        if !complete {
            state.1 = true;
            self.changed.notify_all();
        }
        drop(state);
        assert!(
            complete,
            "native test interlock timed out or its peer failed"
        );
    }

    fn abort(&self) {
        let mut state = self.state.lock().unwrap();
        if state.0 < self.parties {
            state.1 = true;
            self.changed.notify_all();
        }
    }
}

pub(super) struct TestPeer(Vec<Arc<TestBarrier>>);

impl TestPeer {
    pub(super) fn new(barriers: &[&Arc<TestBarrier>]) -> Self {
        Self(barriers.iter().map(|barrier| Arc::clone(barrier)).collect())
    }
}

impl Drop for TestPeer {
    fn drop(&mut self) {
        for barrier in &self.0 {
            barrier.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{TestBarrier, TestPeer};
    use std::{
        sync::{Arc, mpsc},
        thread,
        time::Duration,
    };

    #[test]
    fn abandoned_test_interlock_fails_instead_of_waiting_forever() {
        let barrier = Arc::new(TestBarrier::new(2));
        let (finished, result) = mpsc::channel();
        thread::spawn(move || {
            let failed = std::panic::catch_unwind(|| barrier.wait()).is_err();
            let _ = finished.send(failed);
        });
        assert!(
            result
                .recv_timeout(Duration::from_secs(6))
                .expect("an absent peer must not hang the native test suite")
        );
    }

    #[test]
    fn helper_failure_releases_its_waiting_peer() {
        let barrier = Arc::new(TestBarrier::new(2));
        let (finished, result) = mpsc::channel();
        let waiting = Arc::clone(&barrier);
        let waiter = thread::spawn(move || {
            let failed = std::panic::catch_unwind(|| waiting.wait()).is_err();
            finished.send(failed).unwrap();
        });
        drop(TestPeer::new(&[&barrier]));
        assert!(result.recv_timeout(Duration::from_secs(1)).unwrap());
        waiter.join().unwrap();
    }

    #[test]
    fn completed_handshake_survives_peer_exit() {
        let barrier = Arc::new(TestBarrier::new(2));
        let peer = Arc::clone(&barrier);
        let helper = thread::spawn(move || {
            let _guard = TestPeer::new(&[&peer]);
            peer.wait();
        });
        barrier.wait();
        helper.join().unwrap();
    }
}
