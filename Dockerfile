FROM node:18-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev 2>&1 || npm install
COPY . .
EXPOSE 3000
# 用 exec 形式（PID 1 = node，信号能正确传递）
CMD ["node", "server.js"]
# 备用：shell 形式（某些平台环境会用 sh -c 解析启动命令）
# CMD node server.js
