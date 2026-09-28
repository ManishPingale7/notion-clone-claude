# Backend image (Fly.io). The frontend is deployed separately (Vercel).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --omit=dev && npm cache clean --force
COPY server ./server
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data SECURE_COOKIES=true
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
