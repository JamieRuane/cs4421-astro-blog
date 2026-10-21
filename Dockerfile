
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY container-server.mjs ./container-server.mjs

EXPOSE 8080

USER node

CMD ["node", "container-server.mjs"]
