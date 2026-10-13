FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PORT=7000
EXPOSE 7000

CMD ["node", "src/server.js"]
