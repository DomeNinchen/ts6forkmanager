package main

// Bumped independently of backend/frontend - only when this package
// (packages/sidecar) actually changes. Read by the backend's update-check
// (both live, via GET /version below, and from GitHub's main branch) to
// tell an admin specifically when the sidecar is the component that's
// behind, not just "something somewhere is outdated".
const Version = "2.0.0"
