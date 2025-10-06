import { Router } from 'express';
import ProcessDistancesRPAController  from './controller';

const DistanceRouter = new Router();

DistanceRouter.get('/process', ProcessDistancesRPAController.processDistances);
DistanceRouter.get('/create-queue/one/:id', ProcessDistancesRPAController.createQueueNewAddresses);
DistanceRouter.get('/create-queue/all', ProcessDistancesRPAController.createQueueDistancesForAllAddresses);
DistanceRouter.get('/sync-with-tickets', ProcessDistancesRPAController.syncDistanceInKmWithTickets);
DistanceRouter.post('/calculate', ProcessDistancesRPAController.calculateDistanceFromTo.bind(ProcessDistancesRPAController));

export default DistanceRouter;
// processDistances
// checkDistances
