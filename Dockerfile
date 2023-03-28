FROM public.ecr.aws/v9j3m0a2/node14:latest
#RUN apt install make gcc g++ python

RUN mkdir -p /app/wallet
WORKDIR /app/wallet
COPY package*.json ./
RUN npm install
COPY . .

#RUN npm run build
RUN ls -a

#RUN cp .env.example .env
EXPOSE 3000

CMD ["npm", "run", "start"]
