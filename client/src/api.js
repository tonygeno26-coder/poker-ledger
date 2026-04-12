import axios from 'axios';

const API = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api'
});

export const getPlayers = () => API.get('/players').then(r => r.data);
export const createPlayer = (data) => API.post('/players', data).then(r => r.data);
export const updatePlayer = (id, data) => API.put(`/players/${id}`, data).then(r => r.data);
export const deletePlayer = (id) => API.delete(`/players/${id}`).then(r => r.data);
export const getPlayerStats = (id) => API.get(`/players/${id}/stats`).then(r => r.data);

export const getGames = () => API.get('/games').then(r => r.data);
export const getGame = (id) => API.get(`/games/${id}`).then(r => r.data);
export const saveGame = (data) => API.post('/games', data).then(r => r.data);
export const settleGame = (id) => API.post(`/games/${id}/settle`).then(r => r.data);
export const markPaid = (id) => API.put(`/settlements/${id}/paid`).then(r => r.data);

export const getStats = () => API.get('/stats').then(r => r.data);
