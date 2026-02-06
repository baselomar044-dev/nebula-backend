FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npm run db:migrate

EXPOSE 3000

CMD ["npm", "start"]
