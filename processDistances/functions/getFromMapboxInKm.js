import axios from 'axios';
import { roundNumber } from '../../../app/utils/format';

const MAPBOX_TOKEN = "pk.eyJ1IjoiZm94ZGV2MjAyNSIsImEiOiJjbWRvbmpldDQwM3AyMmxvZjBrNzgzOTBpIn0.0yjXgOp2A7OLopuUZwuVNg";

export const getFromMapboxInKm = async (locations = []) => {
  try {
    if (!Array.isArray(locations) || locations.length === 0) {
      return null;
    }

    const coordinates = [];

    locations.forEach((pair, index) => {
      const fromCoords = pair.from.location.coordinates.join(',');
      const toCoords = pair.to.location.coordinates.join(',');

      // Adiciona as coordenadas e define os índices para sources e destinations
      coordinates.push([fromCoords, toCoords]);
    });

    // Cria promessas de distancias a serem calculadas
    const promisesDistances = coordinates.map((coord) => {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coord[0]};${coord[1]}`;

      // const urlToTest = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coord[0]};${coord[1]}?access_token=${MAPBOX_TOKEN}&annotations=distance&destinations=0&sources=1`;

      const promise = axios.get(url, {
        params: {
          access_token: MAPBOX_TOKEN,
          annotations: 'distance',
        },
      });

      return promise;
    })

    const responses = await Promise.all(promisesDistances);
    const data = responses.map((response) => {
      let item = undefined;
      if(response.data && response.data.routes && response.data.routes.length > 0) {
        item = response?.data.routes[0];
      }
      return item;
    }).filter((item) => item);

    const formattedDistances = data.map((item) => {
      const {distance} = item;
        return roundNumber(distance / 1000, 3); // Conversão para km
      });



    // const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordinatesStr}`;

    // // Requisição à API da Mapbox com parâmetros sources e destinations
    // const { data } = await axios.get(url, {
    //   params: {
    //     access_token: MAPBOX_TOKEN,
    //     annotations: 'distance',
    //     sources: sourcesStr,
    //     destinations: destinationsStr,
    //   },
    // });

    // Processa a matriz de distâncias e formata o resultado
    // const distances = data && data.code === 'Ok' ? data.distances : [];
    // const formattedDistances = distances.map((row, index) => {
    //   const dist = row[index];
    //   return roundNumber(dist / 1000, 3); // Conversão para km
    // });// conversão para km

    // Log e retorno das distâncias
    return formattedDistances;
  } catch (error) {
    console.log('Falha ao buscar distância da nossa API. Por favor, tente mais tarde.', error);
    return null;
  }
};
