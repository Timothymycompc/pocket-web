# Daily live check of every listed site through Pocket Web, in a real phone-sized Chrome.
# Runs as the Cloud Run job pocket-web-peer-check (scheduled daily); see scripts/deploy-job.sh.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /job
RUN npm init -y > /dev/null && npm i --no-save --no-audit --no-fund playwright@1.49.0 > /dev/null
COPY peer-check.mjs run.mjs ./
CMD ["node", "run.mjs"]
