const express = require('express');
const auth = require('../middleware/auth');

const router = express.Router();

// Get user profile (protected route)
router.get('/me', auth, async (req, res) => {
  const User = require('../models/User');
  try {
    res.json({
      user: req.user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error while fetching profile' });
  }
});

// Update user profile
router.put('/me', auth, async (req, res) => {
  const User = require('../models/User');
  try {
    const { fullName, profilePicture, tradingPreferences } = req.body;
    const updates = {};

    if (fullName) {
      updates.fullName = fullName.trim();
    }

    if (profilePicture !== undefined) {
      updates.profilePicture = profilePicture;
    }

    if (tradingPreferences) {
      updates.tradingPreferences = tradingPreferences;
    }

    let user;
    if (global.useInMemoryStorage) {
      user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: updates },
        { new: true }
      );
    } else {
      user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: updates },
        { new: true, runValidators: true }
      ).select('-password');
    }

    res.json({
      message: 'Profile updated successfully',
      user
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Server error while updating profile' });
  }
});

// Change password
router.put('/change-password', auth, async (req, res) => {
  const User = require('../models/User');
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    let user;
    if (global.useInMemoryStorage) {
      user = await User.findById(req.user._id);
    } else {
      user = await User.findById(req.user._id);
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    let isCurrentPasswordValid;
    if (global.useInMemoryStorage) {
      const bcrypt = require('bcryptjs');
      isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    } else {
      isCurrentPasswordValid = await user.comparePassword(currentPassword);
    }

    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(12);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    if (global.useInMemoryStorage) {
      await User.findByIdAndUpdate(req.user._id, { password: hashedNewPassword });
    } else {
      user.password = newPassword;
      await user.save();
    }

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error while changing password' });
  }
});

module.exports = router; 