export const users = [
  {
    id: "u_admin_fabio",
    name: "Fabio Herrera",
    username: "fabio",
    password: "1234", // mock (luego bcrypt)
    role: "admin",
    barberId: null,
  },
  {
    id: "u_barber_nahuel",
    name: "Nahuel Cornejo",
    username: "nahuel",
    password: "1234", // mock (luego bcrypt)
    role: "barber",
    barberId: 2, // IMPORTANTE: debe coincidir con el id del barbero en data.js
  },
];