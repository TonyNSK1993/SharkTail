const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(bodyParser.json());
app.use(cookieParser());

// Раздаем статические файлы из текущей директории
app.use(express.static(path.join(__dirname)));

// Файлы для хранения данных
const DATA_FILE = path.join(__dirname, 'crm_data.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Инициализация файла пользователей, если его нет
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({
    users: [
      {
        id: 1,
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        name: 'Администратор'
      }
    ]
  }, null, 2));
}

// Функции для работы с пользователями
const userDB = {
  getUsers: () => {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data).users;
  },
  
  saveUsers: (users) => {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
  },
  
  findUser: (username) => {
    const users = userDB.getUsers();
    return users.find(u => u.username === username);
  },
  
  findUserById: (id) => {
    const users = userDB.getUsers();
    return users.find(u => u.id === id);
  },
  
  addUser: (user) => {
    const users = userDB.getUsers();
    const newId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
    const newUser = { ...user, id: newId };
    users.push(newUser);
    userDB.saveUsers(users);
    return newUser;
  }
};

// Токены для сессий
const activeSessions = new Map();

// АУТЕНТИФИКАЦИЯ

// Вход
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Заполните все поля' 
      });
    }
    
    const user = userDB.findUser(username);
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Пользователь не найден' 
      });
    }
    
    if (user.password !== password) {
      return res.status(401).json({ 
        success: false, 
        message: 'Неверный пароль' 
      });
    }
    
    // Создаем сессию
    const sessionToken = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const sessionData = {
      userId: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      loginTime: new Date().toISOString()
    };
    
    activeSessions.set(sessionToken, sessionData);
    
    // Устанавливаем куки
    res.cookie('session_token', sessionToken, { 
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: false
    });
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка сервера' 
    });
  }
});

// Регистрация
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, name } = req.body;
    
    if (!username || !password || !name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Заполните все поля' 
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Пароль должен быть не менее 6 символов' 
      });
    }
    
    const existingUser = userDB.findUser(username);
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Пользователь уже существует' 
      });
    }
    
    const newUser = userDB.addUser({
      username,
      password,
      name,
      role: 'user'
    });
    
    // Создаем сессию
    const sessionToken = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const sessionData = {
      userId: newUser.id,
      username: newUser.username,
      role: newUser.role,
      name: newUser.name,
      loginTime: new Date().toISOString()
    };
    
    activeSessions.set(sessionToken, sessionData);
    
    res.cookie('session_token', sessionToken, { 
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: false
    });
    
    res.json({
      success: true,
      user: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        name: newUser.name
      }
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка сервера' 
    });
  }
});

// Выход
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.session_token;
  if (token) {
    activeSessions.delete(token);
  }
  res.clearCookie('session_token');
  res.json({ success: true });
});

// Проверка сессии
app.get('/api/auth/check', (req, res) => {
  const token = req.cookies.session_token;
  
  if (!token || !activeSessions.has(token)) {
    return res.json({ 
      isAuthenticated: false,
      user: null
    });
  }
  
  const sessionData = activeSessions.get(token);
  res.json({
    isAuthenticated: true,
    user: {
      id: sessionData.userId,
      username: sessionData.username,
      role: sessionData.role,
      name: sessionData.name
    }
  });
});

// Middleware для проверки аутентификации
function requireAuth(req, res, next) {
  const token = req.cookies.session_token;
  
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ 
      success: false, 
      message: 'Требуется авторизация' 
    });
  }
  
  req.user = activeSessions.get(token);
  next();
}

// ОСНОВНЫЕ ДАННЫЕ

// Инициализация данных
let data = {
  clients: [],
  cars: [],
  services: [],
  employees: [],
  appointments: [],
  shifts: [],
  carwashes: [],
  washbays: []
};

// Загрузка данных из файла
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const fileData = fs.readFileSync(DATA_FILE, 'utf8');
      data = JSON.parse(fileData);
      console.log('Данные загружены из файла');
    } else {
      console.log('Файл данных не найден, создаем новый');
      saveData();
    }
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
  }
}

// Сохранение данных в файл
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('Данные сохранены');
  } catch (error) {
    console.error('Ошибка сохранения данных:', error);
  }
}

// Генерация ID
function generateId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

// CLIENTS
app.get('/api/clients', (req, res) => {
  res.json(data.clients);
});

app.get('/api/clients/:id', (req, res) => {
  const client = data.clients.find(c => c.id == req.params.id);
  if (client) {
    res.json(client);
  } else {
    res.status(404).json({ error: 'Клиент не найден' });
  }
});

app.post('/api/clients', (req, res) => {
  const client = {
    id: generateId(),
    name: req.body.name || '',
    phone: req.body.phone || '',
    email: req.body.email || '',
    preferences: req.body.preferences || ''
  };
  
  data.clients.push(client);
  saveData();
  res.json(client);
});

app.put('/api/clients/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = data.clients.findIndex(c => c.id === id);
  
  if (index !== -1) {
    data.clients[index] = {
      ...data.clients[index],
      ...req.body,
      id: id
    };
    saveData();
    res.json(data.clients[index]);
  } else {
    res.status(404).json({ error: 'Клиент не найден' });
  }
});

app.delete('/api/clients/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const initialLength = data.clients.length;
  
  data.clients = data.clients.filter(c => c.id !== id);
  
  if (data.clients.length < initialLength) {
    data.cars = data.cars.filter(car => !car.clientIds.includes(id));
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Клиент не найден' });
  }
});

// CARS
app.get('/api/cars', (req, res) => {
  res.json(data.cars);
});

app.get('/api/cars/by-client/:clientId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const clientCars = data.cars.filter(car => 
    car.clientIds && car.clientIds.includes(clientId)
  );
  res.json(clientCars);
});

app.post('/api/cars', (req, res) => {
  const car = {
    id: generateId(),
    clientIds: req.body.clientIds || [],
    plate: req.body.plate || '',
    brand: req.body.brand || '',
    model: req.body.model || '',
    year: req.body.year || null,
    bodyType: req.body.bodyType || 'седан'
  };
  
  data.cars.push(car);
  saveData();
  res.json(car);
});

app.put('/api/cars/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = data.cars.findIndex(c => c.id === id);
  
  if (index !== -1) {
    data.cars[index] = {
      ...data.cars[index],
      ...req.body,
      id: id
    };
    saveData();
    res.json(data.cars[index]);
  } else {
    res.status(404).json({ error: 'Автомобиль не найден' });
  }
});

app.delete('/api/cars/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const initialLength = data.cars.length;
  
  data.cars = data.cars.filter(c => c.id !== id);
  
  if (data.cars.length < initialLength) {
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Автомобиль не найден' });
  }
});

// SERVICES
app.get('/api/services', (req, res) => {
  res.json(data.services);
});

app.post('/api/services', (req, res) => {
  const service = {
    id: generateId(),
    name: req.body.name || '',
    type: req.body.type || 'мойка',
    price: parseFloat(req.body.price) || 0
  };
  
  data.services.push(service);
  saveData();
  res.json(service);
});

app.put('/api/services/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = data.services.findIndex(s => s.id === id);
  
  if (index !== -1) {
    data.services[index] = {
      ...data.services[index],
      ...req.body,
      id: id
    };
    saveData();
    res.json(data.services[index]);
  } else {
    res.status(404).json({ error: 'Услуга не найдена' });
  }
});

app.delete('/api/services/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const initialLength = data.services.length;
  
  data.services = data.services.filter(s => s.id !== id);
  
  if (data.services.length < initialLength) {
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Услуга не найдена' });
  }
});

// EMPLOYEES
app.get('/api/employees', (req, res) => {
  res.json(data.employees);
});

app.post('/api/employees', (req, res) => {
  const employee = {
    id: generateId(),
    name: req.body.name || '',
    phone: req.body.phone || '',
    role: req.body.role || ''
  };
  
  data.employees.push(employee);
  saveData();
  res.json(employee);
});

app.put('/api/employees/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = data.employees.findIndex(e => e.id === id);
  
  if (index !== -1) {
    data.employees[index] = {
      ...data.employees[index],
      ...req.body,
      id: id
    };
    saveData();
    res.json(data.employees[index]);
  } else {
    res.status(404).json({ error: 'Сотрудник не найден' });
  }
});

app.delete('/api/employees/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const initialLength = data.employees.length;
  
  data.employees = data.employees.filter(e => e.id !== id);
  
  if (data.employees.length < initialLength) {
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Сотрудник не найден' });
  }
});

// APPOINTMENTS
app.get('/api/appointments', (req, res) => {
  const { status, carWashId, dateFrom, dateTo } = req.query;
  let filtered = [...data.appointments];
  
  if (status) {
    filtered = filtered.filter(a => a.status === status);
  }
  
  if (carWashId) {
    filtered = filtered.filter(a => {
      const bay = data.washbays.find(b => b.id === a.washBayId);
      return bay && bay.carWashId == carWashId;
    });
  }
  
  if (dateFrom || dateTo) {
    filtered = filtered.filter(a => {
      const apptDate = new Date(a.dateTime).toISOString().split('T')[0];
      if (dateFrom && apptDate < dateFrom) return false;
      if (dateTo && apptDate > dateTo) return false;
      return true;
    });
  }
  
  res.json(filtered);
});

app.get('/api/appointments/recent', (req, res) => {
  const recent = [...data.appointments]
    .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))
    .slice(0, 10);
  res.json(recent);
});

app.post('/api/appointments', (req, res) => {
  const appointment = {
    id: generateId(),
    dateTime: req.body.dateTime || new Date().toISOString(),
    clientId: parseInt(req.body.clientId) || null,
    carId: req.body.carId ? parseInt(req.body.carId) : null,
    serviceId: parseInt(req.body.serviceId) || null,
    employeeId: req.body.employeeId ? parseInt(req.body.employeeId) : null,
    status: req.body.status || 'pending',
    price: parseFloat(req.body.price) || 0,
    comment: req.body.comment || '',
    washBayId: req.body.washBayId ? parseInt(req.body.washBayId) : null
  };
  
  data.appointments.push(appointment);
  saveData();
  res.json(appointment);
});

app.put('/api/appointments/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = data.appointments.findIndex(a => a.id === id);
  
  if (index !== -1) {
    data.appointments[index] = {
      ...data.appointments[index],
      ...req.body,
      id: id
    };
    saveData();
    res.json(data.appointments[index]);
  } else {
    res.status(404).json({ error: 'Запись не найдена' });
  }
});

app.delete('/api/appointments/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const initialLength = data.appointments.length;
  
  data.appointments = data.appointments.filter(a => a.id !== id);
  
  if (data.appointments.length < initialLength) {
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Запись не найдена' });
  }
});

// SHIFTS
app.get('/api/shifts', (req, res) => {
  res.json(data.shifts);
});

app.post('/api/shifts', (req, res) => {
  const shift = {
    id: generateId(),
    date: req.body.date || new Date().toISOString().split('T')[0],
    employeeId: parseInt(req.body.employeeId) || null,
    start: req.body.start || '',
    end: req.body.end || '',
    carsCount: parseInt(req.body.carsCount) || 0
  };
  
  data.shifts.push(shift);
  saveData();
  res.json(shift);
});

app.put('/api/shifts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = data.shifts.findIndex(s => s.id === id);
  
  if (index !== -1) {
    data.shifts[index] = {
      ...data.shifts[index],
      ...req.body,
      id: id
    };
    saveData();
    res.json(data.shifts[index]);
  } else {
    res.status(404).json({ error: 'Смена не найдена' });
  }
});

app.delete('/api/shifts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const initialLength = data.shifts.length;
  
  data.shifts = data.shifts.filter(s => s.id !== id);
  
  if (data.shifts.length < initialLength) {
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Смена не найдена' });
  }
});

// CARWASHES
app.get('/api/carwashes', (req, res) => {
  res.json(data.carwashes);
});

app.post('/api/carwashes', (req, res) => {
  const carWash = {
    id: generateId(),
    name: req.body.name || '',
    address: req.body.address || '',
    isActive: req.body.isActive !== undefined ? req.body.isActive : true
  };
  
  data.carwashes.push(carWash);
  saveData();
  res.json(carWash);
});

app.put('/api/carwashes/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = data.carwashes.findIndex(cw => cw.id === id);
  
  if (index !== -1) {
    data.carwashes[index] = {
      ...data.carwashes[index],
      ...req.body,
      id: id
    };
    saveData();
    res.json(data.carwashes[index]);
  } else {
    res.status(404).json({ error: 'Мойка не найдена' });
  }
});

app.delete('/api/carwashes/:id', (req, res) => {
  const id = parseInt(req.params.id);
  
  const hasBays = data.washbays.some(bay => bay.carWashId === id);
  if (hasBays) {
    return res.status(400).json({ error: 'Нельзя удалить мойку с привязанными местами' });
  }
  
  const initialLength = data.carwashes.length;
  data.carwashes = data.carwashes.filter(cw => cw.id !== id);
  
  if (data.carwashes.length < initialLength) {
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Мойка не найдена' });
  }
});

// WASHBAYS
app.get('/api/washbays', (req, res) => {
  res.json(data.washbays);
});

app.get('/api/washbays/available', (req, res) => {
  const { carWashId, dateTime } = req.query;
  
  if (!carWashId || !dateTime) {
    return res.status(400).json({ error: 'Необходимо указать carWashId и dateTime' });
  }
  
  const targetTime = new Date(dateTime);
  const targetEnd = new Date(targetTime.getTime() + 60 * 60 * 1000);
  
  const availableBays = data.washbays.filter(bay => {
    if (!bay.isActive || bay.carWashId != carWashId) return false;
    
    const conflictingAppt = data.appointments.find(appt => {
      if (appt.washBayId !== bay.id) return false;
      if (appt.status === 'cancelled' || appt.status === 'completed') return false;
      
      const apptStart = new Date(appt.dateTime);
      const apptEnd = new Date(apptStart.getTime() + 60 * 60 * 1000);
      
      return (targetTime < apptEnd && targetEnd > apptStart);
    });
    
    return !conflictingAppt;
  });
  
  res.json(availableBays);
});

app.post('/api/washbays', (req, res) => {
  const washBay = {
    id: generateId(),
    carWashId: parseInt(req.body.carWashId) || null,
    name: req.body.name || '',
    description: req.body.description || '',
    isActive: req.body.isActive !== undefined ? req.body.isActive : true
  };
  
  data.washbays.push(washBay);
  saveData();
  res.json(washBay);
});

app.put('/api/washbays/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = data.washbays.findIndex(wb => wb.id === id);
  
  if (index !== -1) {
    data.washbays[index] = {
      ...data.washbays[index],
      ...req.body,
      id: id
    };
    saveData();
    res.json(data.washbays[index]);
  } else {
    res.status(404).json({ error: 'Моечное место не найдено' });
  }
});

app.delete('/api/washbays/:id', (req, res) => {
  const id = parseInt(req.params.id);
  
  const hasAppointments = data.appointments.some(appt => appt.washBayId === id);
  if (hasAppointments) {
    return res.status(400).json({ error: 'Нельзя удалить место с привязанными записями' });
  }
  
  const initialLength = data.washbays.length;
  data.washbays = data.washbays.filter(wb => wb.id !== id);
  
  if (data.washbays.length < initialLength) {
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Моечное место не найдено' });
  }
});

// DASHBOARD DATA
app.get('/api/dashboard/stats', (req, res) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setMonth(today.getMonth() - 1);
  
  const completedAppointments = data.appointments.filter(a => a.status === 'completed');
  
  const stats = {
    revenueToday: completedAppointments
      .filter(a => new Date(a.dateTime).toDateString() === today.toDateString())
      .reduce((sum, a) => sum + (a.price || 0), 0),
    
    revenueWeek: completedAppointments
      .filter(a => new Date(a.dateTime) >= weekAgo)
      .reduce((sum, a) => sum + (a.price || 0), 0),
    
    revenueMonth: completedAppointments
      .filter(a => new Date(a.dateTime) >= monthAgo)
      .reduce((sum, a) => sum + (a.price || 0), 0),
    
    completedToday: completedAppointments
      .filter(a => new Date(a.dateTime).toDateString() === today.toDateString())
      .length,
    
    activeWeek: data.appointments
      .filter(a => new Date(a.dateTime) >= weekAgo && a.status !== 'cancelled')
      .length,
    
    totalAppointments: data.appointments.length,
    totalClients: data.clients.length,
    totalCars: data.cars.length
  };
  
  res.json(stats);
});

app.get('/api/dashboard/charts', (req, res) => {
  const now = new Date();
  const dailyData = [];
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    
    dailyData.push({
      date: d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }),
      count: data.appointments.filter(a => a.dateTime.startsWith(iso)).length
    });
  }
  
  const serviceCounts = {};
  data.appointments.forEach(a => {
    const service = data.services.find(s => s.id === a.serviceId);
    if (service) {
      serviceCounts[service.name] = (serviceCounts[service.name] || 0) + 1;
    }
  });
  
  const topServices = Object.entries(serviceCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  res.json({
    daily: dailyData,
    topServices: topServices
  });
});

// LOAD DASHBOARD
app.get('/api/load-dashboard', (req, res) => {
  const { date } = req.query;
  const selectedDate = date || new Date().toISOString().split('T')[0];
  
  const result = data.carwashes.map(carWash => {
    const washBays = data.washbays.filter(bay => bay.carWashId === carWash.id);
    
    const schedule = washBays.map(bay => {
      const slots = [];
      
      for (let hour = 8; hour < 22; hour++) {
        const slotStart = new Date(selectedDate + 'T' + hour.toString().padStart(2, '0') + ':00');
        const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
        
        const appointment = data.appointments.find(appt => {
          if (appt.washBayId !== bay.id) return false;
          if (appt.status === 'cancelled') return false;
          
          const apptStart = new Date(appt.dateTime);
          const apptEnd = new Date(apptStart.getTime() + 60 * 60 * 1000);
          
          return (slotStart < apptEnd && slotEnd > apptStart);
        });
        
        slots.push({
          hour: `${hour}:00`,
          appointmentId: appointment ? appointment.id : null,
          status: appointment ? appointment.status : 'free'
        });
      }
      
      return {
        bayId: bay.id,
        bayName: bay.name,
        slots: slots
      };
    });
    
    return {
      carWashId: carWash.id,
      carWashName: carWash.name,
      schedule: schedule
    };
  });
  
  res.json(result);
});

// SEARCH
app.get('/api/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  const results = [];
  
  if (!query) {
    return res.json(results);
  }
  
  data.clients.forEach(client => {
    if (client.name.toLowerCase().includes(query) || 
        (client.phone || '').toLowerCase().includes(query)) {
      results.push({
        type: 'client',
        id: client.id,
        text: client.name,
        entity: client
      });
    }
  });
  
  data.cars.forEach(car => {
    if (car.plate.toLowerCase().includes(query)) {
      results.push({
        type: 'car',
        id: car.id,
        text: `${car.plate} — ${car.brand} ${car.model}`,
        entity: car
      });
    }
  });
  
  data.services.forEach(service => {
    if (service.name.toLowerCase().includes(query)) {
      results.push({
        type: 'service',
        id: service.id,
        text: service.name,
        entity: service
      });
    }
  });
  
  res.json(results.slice(0, 10));
});

// SEED DEMO DATA
app.post('/api/seed', (req, res) => {
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 16);
  
  data = {
    clients: [
      { id: 1, name: "Иван Петров", phone: "+79991112233", email: "ivan@example.com", preferences: "Только ручная мойка" },
      { id: 2, name: "Мария Соколова", phone: "+79003332211", email: "maria@example.com", preferences: "" },
      { id: 3, name: "Алексей Иванов", phone: "+79994445566", email: "alex@example.com", preferences: "" }
    ],
    cars: [
      { id: 1, clientIds: [1], plate: "А123ВС", brand: "Toyota", model: "Camry", year: 2020, bodyType: "седан" },
      { id: 2, clientIds: [2], plate: "О987КХ", brand: "Kia", model: "Rio", year: 2019, bodyType: "хэтчбек" },
      { id: 3, clientIds: [1, 2], plate: "Е555ТТ", brand: "BMW", model: "X5", year: 2021, bodyType: "внедорожник" }
    ],
    services: [
      { id: 1, name: "Ручная мойка", type: "мойка", price: 800 },
      { id: 2, name: "Антидеготь", type: "доп", price: 300 },
      { id: 3, name: "Химчистка салона", type: "доп", price: 1500 },
      { id: 4, name: "Комплексная мойка", type: "мойка", price: 1200 }
    ],
    employees: [
      { id: 1, name: "Андрей", phone: "+79994445566", role: "Мойщик" },
      { id: 2, name: "Сергей", phone: "+79995556677", role: "Старший мойщик" }
    ],
    carwashes: [
      { id: 1, name: "Главная мойка", address: "ул. Центральная, 1", isActive: true },
      { id: 2, name: "Филиал Северный", address: "ул. Северная, 15", isActive: true },
      { id: 3, name: "Мойка Премиум", address: "пр. Ленина, 45", isActive: false }
    ],
    washbays: [
      { id: 1, carWashId: 1, name: "Пост №1", description: "Основной пост", isActive: true },
      { id: 2, carWashId: 1, name: "Пост №2", description: "Бокс для внедорожников", isActive: true },
      { id: 3, carWashId: 2, name: "Бокс А", description: "Быстрая мойка", isActive: true },
      { id: 4, carWashId: 2, name: "Бокс Б", description: "Комплексная мойка", isActive: true },
      { id: 5, carWashId: 3, name: "VIP бокс", description: "Премиум обслуживание", isActive: false }
    ],
    appointments: [
      { id: 1, dateTime: new Date(Date.now()-3*24*3600*1000).toISOString(), clientId: 1, carId: 1, serviceId: 1, employeeId: 1, status: "completed", price: 800, comment: "", washBayId: 1 },
      { id: 2, dateTime: new Date(Date.now()-2*24*3600*1000).toISOString(), clientId: 2, carId: 2, serviceId: 2, employeeId: 2, status: "completed", price: 300, comment: "", washBayId: 2 },
      { id: 3, dateTime: isoDate, clientId: 1, carId: 1, serviceId: 3, employeeId: 1, status: "confirmed", price: 1500, comment: "Предварительная запись", washBayId: 1 },
      { id: 4, dateTime: new Date(Date.now()+2*3600*1000).toISOString(), clientId: 3, carId: 3, serviceId: 4, employeeId: 2, status: "pending", price: 1200, comment: "", washBayId: 3 }
    ],
    shifts: [
      { id: 1, date: new Date().toISOString().split('T')[0], employeeId: 1, start: "09:00", end: "18:00", carsCount: 8 },
      { id: 2, date: new Date().toISOString().split('T')[0], employeeId: 2, start: "10:00", end: "19:00", carsCount: 12 }
    ]
  };
  
  saveData();
  res.json({ success: true, message: 'Демо-данные загружены' });
});

// Главная страница - отдаем index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Загрузка данных при запуске
loadData();

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`📁 Frontend доступен по адресу http://localhost:${PORT}`);
  console.log(`🔗 API доступен по адресу http://localhost:${PORT}/api/...`);
  console.log('\n📋 Доступные endpoints:');
  console.log('- GET  / - главная страница CRM');
  console.log('- POST /api/auth/login - вход');
  console.log('- POST /api/auth/register - регистрация');
  console.log('- GET  /api/auth/check - проверка сессии');
  console.log('- POST /api/seed - загрузить демо-данные');
  console.log('\n🔑 Тестовые данные для входа:');
  console.log('- Логин: admin');
  console.log('- Пароль: admin123');
});