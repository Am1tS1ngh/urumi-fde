FROM node:24.16.0-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3002
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY app.mjs server.mjs ./
USER node
EXPOSE 3002
CMD ["node", "server.mjs"]
