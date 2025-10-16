import Address from "../../../app/models/Address";
import Queue_distances from "../../../app/models/Queue_distances";
import Offer from "../../../app/models/Offer";

export default async function createQueueNewAddresses(address, isBuyAddress) {
  try {
    const offersMap = new Map();

    let [lotNumber, offersAddresses] = await Promise.all([
      (Queue_distances.findOne({ processing: false }).select('lot').sort({ lot: -1 }).lean().then((queue) => queue?.lot) || 1),
      Offer.find({
        isCanceled: false,
        isDone: false,
        expiresIn: { $gt: new Date() },
        isBuying: !isBuyAddress,
      }).select('address').populate({
        path: 'address',
        select: '_id location',
      }).lean().then((offers) => offers.map((item) => {
        offersMap.set(item.address._id.toString(), {
          _id: item.address._id,
          location: item.address.location,
        });
      })),
    ]);

    offersAddresses = Array.from(offersMap.values());

    if (!address) {
      throw new Error('Endereço não encontrado.');
    }

    if (!lotNumber) lotNumber = 1;

    const addressPairs = offersAddresses.map((offerAddress) => ({
      from: isBuyAddress ? offerAddress : address,
      to: isBuyAddress ? address : offerAddress,
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
          lot: lotNumber++,
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
      return true;
    }

    return true;

  } catch (err) {
    console.error('Error during distance queue creation:', err);
    return err;
  }
}
