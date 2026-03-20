FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN chmod +x start.sh
EXPOSE ${PORT:-3000}
CMD ["sh", "start.sh"]
