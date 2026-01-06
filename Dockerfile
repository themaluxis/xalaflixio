FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY src ./src

EXPOSE 7000

ENV PORT=7000
ENV ADDON_HOST=http://127.0.0.1:7000

CMD ["node", "src/index.js"]
