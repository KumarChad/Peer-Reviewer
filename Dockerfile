FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY README.md ./

ENV PORT=7860

EXPOSE 7860

CMD ["npm", "start"]
