import Queue_distances from '../../app/models/Queue_distances';
import Distance from '../../app/models/Distance';
import { getFromMapboxInKm } from './functions/getFromMapboxInKm';
import HttpError from '../../app/models/HttpError';
import Address from '../../app/models/Address';
import Ticket from '../../v2/models/Ticket';
import Offer from '../../app/models/Offer'
import calculateDistance from './functions/calculateDistance';

class ProcessDistancesRPAController {

  async processDistances(req, res, next) {
    let id = null;
    let queueEntrys = null;

    try {
      let queueEntrys = await Queue_distances.find({ processing: false })
        .sort({ lot: 1, createdAt: 1 })
        .limit(5)
        .lean();

       // Verifica se `queueEntry` foi encontrado
        if (!queueEntrys) {
          return res.status(200).json({ message: 'Nenhum lote pendente na fila.' });
        }
        
         await Queue_distances.updateMany(
          { _id: { $in: queueEntrys.map(q => q._id) } },
          { $set: { processing: true } }
        );
        

      for (const queueEntry of queueEntrys) {

        id = queueEntry._id;

        const { addresses } = queueEntry;

        const addressUpdated = [];
        const seen = new Set();

        for (const addr of addresses) {
          const key = `${addr.from._id}_${addr.to._id}`;
          if (seen.has(key)) continue;

          const exists = await Distance.findOne({
            from: addr.from._id,
            to: addr.to._id
          }).lean();

          if (!exists) {
            addressUpdated.push(addr);
            seen.add(key); 
          }
        }

        // Consome a API para obter as distâncias
        const distanceValues = await getFromMapboxInKm(addressUpdated);

        // Cria um array de documentos Distance para inserção
        const distancesArray = addressUpdated.map((pair, index) => ({
          from: pair.from._id,
          to: pair.to._id,
          inKm: distanceValues[index],
        }));
          // Insere as distâncias calculadas no banco de dados
          await Distance.insertMany(distancesArray);
      }
        return res.json({ message: 'Lotes processado com sucesso.' });

    } catch (error) {
      await Queue_distances.updateMany(
        { _id: { $in: queueEntrys.map(q => q._id) } },
        { $set: { processing: false } }
      );

      await Queue_distances.updateOne(
        { _id: id },
        { $set: { errorMessages: error, processing: true } }
      );

      return res.status(500).json({
        message: 'Ocorreu um erro durante o processamento do lote. '+error.message,
        error: error.message
      });
    }
  };

  async createQueueNewAddresses(req, res, next) {
    try {
      const { id } = req?.params;

      if (!id) {
        return next(new HttpError(400, 'ID do endereço não informado.'));
      }

      const [address, lotNumber, offersAddresses] = await Promise.all([
        Address.findById(id).select('_id isBuyAddress').lean(),
        Queue_distances.findOne({ processing: false }).select('lot').sort({ lot: -1 }).lean().then((queue) => queue?.lot),
        Offer.find({
          isCanceled: false,
          isDone: false,
          expiresIn: { $gt: new Date() },
          isBuying: !isBuyAddress,
        }).select('address').populate({
          path: 'address',
          select: '_id location',
        }).lean().then((offers) => offers.map((item) => {
          return {
            [isBuyAddress ? 'from' : 'to']: item._id,
            location: item.address.location,
          };
        })),
      ]);

      if (!address) {
        return next(new HttpError(404, 'Endereço não encontrado.'));
      }

      const addressPairs = offersAddresses.map((offerAddress) => ({
        from: isBuyAddress ? address : offerAddress,
        to: isBuyAddress ? offerAddress : address,
      }));

      // Dividir os pares em lotes de até 12 itens
      const batchSize = 12;
      const batches = [];
      for (let i = 0; i < addressPairs.length; i += batchSize) {
        batches.push(addressPairs.slice(i, i + batchSize));
      }

      // Preparar operações em massa para inserir na coleção queue_distances
      const bulkOperations = batches.map((batch) => ({
        insertOne: {
          document: {
            lot: ++lotNumber,
            addresses: batch.map((pair) => ({
              from: {
                _id: pair.from._id,
                location: pair.from.location,
              },
              to: {
                _id: pair.to._id,
                location: pair.to.location,
              },
            })),
            processing: false,
            errorMessages: {},
          },
        },
      }));

      // Inserir os lotes na coleção queue_distances
      if (bulkOperations.length > 0) {
        await Queue_distances.bulkWrite(bulkOperations);
        return res.json({
          status: 'OK',
          message: `Foram criados ${bulkOperations.length} lotes na fila de distâncias.`,
        });
      } else {
        return res.json({
          status: 'OK',
          message: 'Nenhum novo par de endereços para processar.',
        });
      }
    } catch (err) {
      return next(new HttpError(500, 'Erro ao criar fila de endereços.', err));
    }
  }

  async createQueueDistancesForAllAddresses(req, res, next) {
    try {
      const distanceMap = new Map();

      let [buyAddresses, sellerAddresses, lastLotNumber] = await Promise.all([
        Address.find({ isBuyAddress: true, isActive: true }).select('_id location').lean(),
        Address.find({ isBuyAddress: false, isActive: true }).select('_id location').lean(),
        Queue_distances.findOne({ processing: false }).select('lot').sort({ lot: -1 }).lean().then((queue) => (queue?.lot || 1)),
      ]);


      const addressPairs = [];

      for (const buyAddress of buyAddresses) {
        const distances = await Distance.find(
          {
            to: buyAddress._id,
          }
        ).select('from to').lean().then((distances) => {
          distances.forEach((distance) => {
            distanceMap.set(`${distance.from}-${distance.to}`, true);
          });
          return distances;
        });

        sellerAddresses.forEach((sellerAddress) => {
          if (!distanceMap.has(`${sellerAddress._id}-${buyAddress._id}`)) {
            addressPairs.push({
              to: {
                _id: buyAddress._id,
                location: buyAddress.location,
              },
              from: {
                _id: sellerAddress._id,
                location: sellerAddress.location,
              },
            });
          }
        });
      }

      // Dividir os pares em lotes de até 12 itens
      const batchSize = 12;

      const batches = [];
      for (let i = 0; i < addressPairs.length; i += batchSize) {
        batches.push(addressPairs.slice(i, i + batchSize));
      }

      // Preparar operações em massa para inserir na coleção queue_distances
      const bulkOperations = batches.map((batch) => {
        lastLotNumber = lastLotNumber + 1;
        return {
          insertOne: {
            document: {
              lot: lastLotNumber,
              addresses: batch,
              processing: false,
              errorMessages: {},
            },
          }
        }
      })
      // Inserir os lotes na coleção queue_distances
      if (bulkOperations.length > 0) {
        await Queue_distances.bulkWrite(bulkOperations);
        return res.json({
          status: 'OK',
          message: `Foram criados ${bulkOperations.length} lotes na fila de distâncias.`,
        });
      } else {
        return res.json({
          status: 'OK',
          message: 'Nenhum novo par de endereços para processar.',
        });
      }

    } catch (error) {
      return next(new HttpError(500, 'Erro ao criar fila de distâncias.', error));
    }
  }

  async syncDistanceInKmWithTickets(req, res, next) {
    try {
      let tickets = await Ticket.find({
        $or: [
          { "transactions.distanceInKm": { $exists: false } },
          { "transactions.distanceInKm": { $lt: 1 } },
          { "transactions.distanceInKm": { $not: { $type: "number" } } },
          { "transactions.1.distanceInKm": { $exists: true, $not: { $type: "number" } } }
        ]

      }).populate({
        path: 'transactions',
        populate: {
          path: 'originOrder destinationOrder',
          select: 'to from',
          populate: {
            path: 'to from',
            select: '_id location'
          }
        }
      }).lean().then(result => result.map(item => {
        return item.transactions.map((transaction, index) => {
          if (!transaction || !transaction.originOrder || !transaction.originOrder.from || !transaction.destinationOrder || !transaction.destinationOrder.to) return null;
          return {
            _id: item._id,
            to: transaction.destinationOrder.to._id,
            from: transaction.originOrder.from._id,
            index,
            toLocation: transaction.destinationOrder.to.location,
            fromLocation: transaction.originOrder.from.location,
          }
        });
      }));

      tickets = tickets.flatMap(T => T.filter(t => t !== null));

      const distancesMap = new Map();
      await Distance.find({
        from: { $in: tickets.map(ticket => ticket.from) },
        to: { $in: tickets.map(ticket => ticket.to) }
      }).select('from to inKm').lean().then(result => result.map(item => {
        distancesMap.set(`${item.from}-${item.to}`, item.inKm);
      }));

      if (tickets.length === 0) {
        return res.json({
          status: 'OK',
          message: 'Nenhum ticket encontrado para sincronização de distâncias.'
        });
      }

      const bulkOperations = [];
      const addressPairs = [];
      let lastLotNumber = 1;


      for (const ticket of tickets) {
        const distance = distancesMap.get(`${ticket.from}-${ticket.to}`);
        if (distance) {
          bulkOperations.push({
            updateOne: {
              filter: {
                _id: ticket._id,
              },
              update: {
                $set: {
                  [`transactions.${ticket.index}.distanceInKm`]: distance
                }
              }
            }
          });
        } else {
          addressPairs.push({
            from: {
              _id: ticket.from,
              location: ticket.fromLocation,
            },
            to: {
              _id: ticket.to,
              location: ticket.toLocation,
            },
          });
        }
      }
      // Dividir os pares em lotes de até 12 itens
      const batchSize = 12;

      const batches = [];
      for (let i = 0; i < addressPairs.length; i += batchSize) {
        batches.push(addressPairs.slice(i, i + batchSize));
      }

      // Preparar operações em massa para inserir na coleção queue_distances
      const QueueOperations = batches.map((batch) => {
        lastLotNumber = lastLotNumber + 1;
        return {
          insertOne: {
            document: {
              lot: lastLotNumber,
              addresses: batch,
              processing: false,
              errorMessages: {},
            },
          }
        }
      })

      if (QueueOperations.length > 0) {
        await Queue_distances.bulkWrite(QueueOperations);
      }



      if (bulkOperations.length === 0) {
        return res.json({
          status: 'OK',
          message: 'Todos os tickets foram sincronizados com distâncias.'
        });
      }

      // Executa as operações em lote
      await Ticket.bulkWrite(bulkOperations);

      return res.json({
        status: 'OK',
        message: `Foram sincronizadas ${bulkOperations.length} distâncias com tickets.`
      });
    } catch (err) {
      return next(new HttpError(500, 'Erro ao sincronizar distâncias com tickets.', err));
    }
  }

  async calculateDistanceFromTo(req, res, next) {
    try {
      const { fromId, toId } = req.body;

      if (!fromId || !toId) {
        return res.status(400).json({ message: 'fromId e toId são obrigatórios.' });
      }

      // Busca os endereços completos
      const [from, to] = await Promise.all([
        Address.findById(fromId).lean(),
        Address.findById(toId).lean()
      ]);

      if (!from || !to) {
        return res.status(404).json({ message: 'Endereço de origem ou destino não encontrado.' });
      }

      // Adiciona o par na fila (se não existir)
      await calculateDistance(from, to);
      const processResult = await this.processDistances({ params: {} }, { json: (data) => data, status: (code) => ({ json: (data) => data }) });

      return res.json({
      status: 'OK', 
      message: 'Distância calculada com sucesso.',
      processed: processResult.message
      });
    } catch (err) {
      return next(new HttpError(500, 'Erro ao adicionar par de endereços para cálculo de distância.', err));
    }
  }

}

export default new ProcessDistancesRPAController();
