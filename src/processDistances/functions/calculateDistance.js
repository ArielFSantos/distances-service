import Queue_distances from "../../../app/models/Queue_distances";

export default async function calculateDistance(from, to) {
  try {
    // Verificar se o par já existe na fila
    const pairExists = await Queue_distances.findOne({
      processing: false,
      $or: [
        { 
          addresses: { 
            $elemMatch: { 
              'from._id': from._id, 
              'to._id': to._id 
            } 
          } 
        },
        { 
          addresses: { 
            $elemMatch: { 
              'from._id': to._id, 
              'to._id': from._id 
            } 
          } 
        }
      ]
    });


    if (pairExists) {
      return;
    }

    const savedQueue = await Queue_distances.findOneAndUpdate(
      { processing: false, $expr: { $lt: [{ $size: '$addresses' }, 12] } },
      {
        $push: {
          addresses: {
            from: { _id: from._id, location: from.location },
            to: { _id: to._id, location: to.location }
          }
        }
      }, {
      sort: { lot: 1, createdAt: 1 },
    }
    );

    if (!savedQueue) {
      const newQueue = new Queue_distances({
        addresses: [{
          from: { _id: from._id, location: from.location },
          to: { _id: to._id, location: to.location }
        }],
        processing: false,
        errorMessages: {},
        lot: 1
      });
      await newQueue.save();
    }

  } catch (error) {
    console.error('Error during distance calculation:', error);
    return error;
  }
}
