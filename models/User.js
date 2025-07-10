const bcrypt = require('bcryptjs');

// Check if we should use in-memory storage
if (global.useInMemoryStorage) {
  // In-memory storage methods
  const inMemoryUserMethods = {
    async findOne(query) {
      if (global.inMemoryUsers) {
        const users = Array.from(global.inMemoryUsers.values());
        return users.find(user => {
          if (query.email) return user.email === query.email;
          if (query._id) return user._id === query._id;
          return false;
        });
      }
      return null;
    },

    async findById(id) {
      if (global.inMemoryUsers) {
        return global.inMemoryUsers.get(id);
      }
      return null;
    },

    async create(userData) {
      if (global.inMemoryUsers) {
        const id = Date.now().toString();
        const user = {
          _id: id,
          fyers: {
            accessToken: null,
            refreshToken: null,
            profile: null,
            connected: false
          },
          ...userData,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        global.inMemoryUsers.set(id, user);
        return user;
      }
      return null;
    },

    async findByIdAndUpdate(id, updates, options) {
      if (global.inMemoryUsers) {
        const user = global.inMemoryUsers.get(id);
        if (user) {
          const updatedUser = { ...user, ...updates, updatedAt: new Date() };
          global.inMemoryUsers.set(id, updatedUser);
          return updatedUser;
        }
      }
      return null;
    }
  };

  module.exports = inMemoryUserMethods;
} else {
  // MongoDB/Mongoose model
  const mongoose = require('mongoose');

  const fyersSchema = new mongoose.Schema({
    accessToken: { type: String, default: null },
    refreshToken: { type: String, default: null },
    profile: { type: mongoose.Schema.Types.Mixed, default: null },
    connected: { type: Boolean, default: false }
  }, { _id: false });

  const userSchema = new mongoose.Schema({
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [100, 'Full name cannot exceed 100 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters long']
    },
    profilePicture: {
      type: String,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date,
      default: Date.now
    },
    tradingPreferences: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {}
    },
    fyers: {
      type: fyersSchema,
      default: () => ({})
    }
  }, {
    timestamps: true
  });

  // Hash password before saving
  userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
      next();
    } catch (error) {
      next(error);
    }
  });

  // Method to compare password
  userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };

  // Method to get user profile (without password)
  userSchema.methods.getProfile = function() {
    const userObject = this.toObject();
    delete userObject.password;
    return userObject;
  };

  module.exports = mongoose.model('User', userSchema);
} 