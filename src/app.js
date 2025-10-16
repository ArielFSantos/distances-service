import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import HttpError from './models/HttpError.js';
import processOffersRouter from './routes/processOffersRouter.js';
import './database/index.js';
import logActivity from './middlewares/logActivityT.js';

class App {
  constructor() {
    this.server = express();
    this.middlewares();
    this.routes();
  }

  middlewares() {
    this.server.use(cors());
    this.server.use(express.json({ limit: '50mb' }));
  }

  routes() {
    this.server.disable('x-powered-by');
    this.server.use(logActivity);
    this.server.use('/api', processOffersRouter);

    // Rota não encontrada
    this.server.use((req, res, next) => {
      next(new HttpError('Ops, não conseguimos encontrar a rota informada.', 404));
    });

    // Middleware de erro
    this.server.use((error, req, res, next) => {
      if (res.headersSent) {
        return next(error);
      }
      res.status(error.code || 500).json({
        data: null,
        message: error.message || 'Ocorreu um erro desconhecido.',
        status: 'ERRO',
      });
    });
  }
}

export default new App().server;
