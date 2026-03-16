## Decisions
- Chose to add --cpus 3 and --memory 2g to remote-deploy.sh production docker run to enforce explicit limits without removing existing allocation behavior.
- Increased docker-compose.production.yml resource limits to reflect higher load in preview and align with production constraints.
