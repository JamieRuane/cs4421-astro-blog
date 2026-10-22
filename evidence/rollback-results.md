# Week 7 – ECS Rollback Drill

## Environment
- AWS Region: `eu-west-1`
- ECS Cluster: `week7-container-cluster`
- ECS Service: `week7-container-blog`
- Known-good task definition: Revision 3
- Deliberately failing task definition: Revision 4
- Failure mechanism: `HEALTH_FAIL=true`

## Test procedure
1. Confirmed revision 3 was healthy.
2. Registered revision 4 with `HEALTH_FAIL=true`.
3. Deployed the failing revision.
4. Observed ECS report a container health-check failure.
5. Manually requested restoration of revision 3.
6. Verified that the service returned to a healthy state.

## Results
- Failure detected: Yes — ECS reported a failed container health check.
- Recovery method: Manual restoration to revision 3.
- Automatic circuit-breaker rollback: Not confirmed.
- Recovery time: Not yet measured.
- Under-60-second target: Not yet verified.


## Conclusion
The health-check failure was detected, and the service was manually restored to the known-good revision. Automatic rollback and the 60-second recovery target require separate verification.
