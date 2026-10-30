# Spec Delta

## REMOVED Requirements

### Requirement: job-ui shows that it has started
**Reason**: job-ui now shows the jobs list as its start page and reads jobs from job-service, so
the placeholder "started" page and its "no backend call" rule no longer hold.
**Migration**: The start page and its behaviour are specified in the `job-ui` capability
("Pages have their own URLs", "The jobs list shows jobs newest first").
