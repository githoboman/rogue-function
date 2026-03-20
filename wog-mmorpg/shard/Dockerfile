FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY . .
EXPOSE ${PORT:-3000}
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
