const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabaseService');
const bcrypt = require('bcryptjs');

// User registration/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phoneNumber, address } = req.body;
    
    console.log(`👤 User signup attempt: ${email}`);
    console.log('📝 Signup data:', { email, firstName, lastName, phoneNumber, address });
    
    // Validate input
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, first name, and last name are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Sign up user in Supabase Auth with email confirmation
    const { data, error } = await supabaseService.client.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          phone_number: phoneNumber,
          address: address
        },
        // Set email redirect URL for confirmation
        emailRedirectTo: `${process.env.CLIENT_URL || 'http://localhost:3000'}/auth/confirm`
      }
    });

    if (error) {
      console.error('❌ Supabase auth error:', error);
      throw error;
    }

    const user = data.user;
    const session = data.session;
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User creation failed - no user returned'
      });
    }

    console.log(`✅ Auth user created: ${user.id}`);
    console.log(`📧 Email confirmation status: ${user.email_confirmed_at ? 'Confirmed' : 'Pending'}`);

    // Hash password for storage in users_registered table (since column requires NOT NULL)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user profile in users_registered table WITH password (to satisfy NOT NULL constraint)
    const { data: userInfo, error: userError } = await supabaseService.client
      .from('users_registered')
      .insert({
        user_id: user.id,
        first_name: firstName,
        last_name: lastName,
        address: address || null,
        phone_number: phoneNumber || null,
        email: email,
        password: hashedPassword, // Store hashed password to satisfy NOT NULL constraint
        date_registered: new Date().toISOString()
      })
      .select()
      .single();

    if (userError) {
      console.error('❌ User info creation error:', userError);
      // If users_registered insert fails, delete the auth user to maintain consistency
      await supabaseService.client.auth.admin.deleteUser(user.id);
      throw userError;
    }

    console.log(`✅ User info created successfully: ${user.id}`);
    
    // Check if email needs confirmation
    const requiresConfirmation = !user.email_confirmed_at;
    
    res.status(201).json({
      success: true,
      message: requiresConfirmation 
        ? 'User created successfully! Please check your email for confirmation link.'
        : 'User created and logged in successfully!',
      user: {
        id: user.id,
        email: user.email,
        firstName: firstName,
        lastName: lastName,
        phoneNumber: phoneNumber,
        address: address,
        emailConfirmed: !!user.email_confirmed_at
      },
      requiresEmailConfirmation: requiresConfirmation,
      // Include session if email is already confirmed
      session: requiresConfirmation ? null : session,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Signup failed:', error.message);
    
    let errorMessage = 'Registration failed';
    
    if (error.message.includes('User already registered')) {
      errorMessage = 'Email already exists';
    } else if (error.message.includes('users_registered')) {
      errorMessage = 'Failed to create user profile';
    } else if (error.message.includes('duplicate key value violates unique constraint')) {
      errorMessage = 'Email already exists in our system';
    } else if (error.message.includes('password')) {
      errorMessage = 'Password does not meet requirements';
    } else if (error.message.includes('null value in column "password"')) {
      errorMessage = 'Database configuration error. Please contact support.';
    }

    res.status(400).json({
      success: false,
      message: errorMessage,
      error: error.message
    });
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log(`🔐 User login attempt: ${email}`);
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Sign in user in Supabase Auth
    const { data, error } = await supabaseService.client.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      console.error('❌ Supabase auth error:', error);
      
      // Provide more specific error messages
      if (error.message.includes('Invalid login credentials')) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      } else if (error.message.includes('Email not confirmed')) {
        return res.status(401).json({
          success: false,
          message: 'Please confirm your email address before logging in',
          requiresConfirmation: true
        });
      } else if (error.message.includes('Invalid email')) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email address'
        });
      }
      throw error;
    }

    const user = data.user;
    const session = data.session;

    // Get user info from users_registered table
    const { data: userInfo, error: userError } = await supabaseService.client
      .from('users_registered')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (userError) {
      console.error('❌ User info fetch error:', userError);
      throw userError;
    }

    console.log(`✅ User logged in successfully: ${user.id}`);
    
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name,
        phoneNumber: userInfo.phone_number,
        address: userInfo.address,
        emailConfirmed: !!user.email_confirmed_at
      },
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Login failed:', error.message);
    
    let errorMessage = 'Login failed';
    if (error.message.includes('Invalid login credentials')) {
      errorMessage = 'Invalid email or password';
    } else if (error.message.includes('Email not confirmed')) {
      errorMessage = 'Please confirm your email address before logging in';
    }

    res.status(401).json({
      success: false,
      message: errorMessage,
      error: error.message
    });
  }
});

// Resend confirmation email
router.post('/resend-confirmation', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log(`📧 Resending confirmation email to: ${email}`);

    const { data, error } = await supabaseService.client.auth.resend({
      type: 'signup',
      email: email,
      options: {
        emailRedirectTo: `${process.env.CLIENT_URL || 'http://localhost:3000'}/auth/confirm`
      }
    });

    if (error) {
      console.error('❌ Resend confirmation error:', error);
      throw error;
    }

    console.log(`✅ Confirmation email resent to: ${email}`);

    res.json({
      success: true,
      message: 'Confirmation email sent successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Resend confirmation failed:', error.message);
    
    let errorMessage = 'Failed to send confirmation email';
    if (error.message.includes('already confirmed')) {
      errorMessage = 'Email is already confirmed';
    } else if (error.message.includes('rate limit')) {
      errorMessage = 'Please wait before requesting another confirmation email';
    }

    res.status(400).json({
      success: false,
      message: errorMessage,
      error: error.message
    });
  }
});

// Check email confirmation status
router.post('/check-confirmation-status', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log(`🔍 Checking confirmation status for: ${email}`);

    // Alternative method: try to get user by email via admin API
    const { data: { users }, error: listError } = await supabaseService.client.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Admin list users error:', listError);
      return res.status(400).json({
        success: false,
        message: 'Unable to check confirmation status'
      });
    }

    const targetUser = users.find(u => u.email === email);
    
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isConfirmed = !!targetUser.email_confirmed_at;

    console.log(`📧 Confirmation status for ${email}: ${isConfirmed ? 'Confirmed' : 'Pending'}`);

    res.json({
      success: true,
      emailConfirmed: isConfirmed,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        emailConfirmedAt: targetUser.email_confirmed_at
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Check confirmation status failed:', error.message);
    res.status(400).json({
      success: false,
      message: 'Failed to check confirmation status: ' + error.message
    });
  }
});

// Verify Supabase access token
router.post('/verify-token', async (req, res) => {
  try {
    const { access_token } = req.body;
    
    if (!access_token) {
      return res.status(400).json({
        success: false,
        message: 'Access token is required'
      });
    }

    console.log('🔍 Verifying Supabase access token...');
    
    // Get user from session using the token
    const { data, error } = await supabaseService.client.auth.getUser(access_token);
    
    if (error) throw error;

    const user = data.user;
    
    // Get user info from users_registered table
    const { data: userInfo, error: userError } = await supabaseService.client
      .from('users_registered')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      throw userError;
    }

    console.log(`✅ Token verified for user: ${user.id}`);
    
    res.json({
      success: true,
      message: 'Token verified successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: userInfo?.first_name || '',
        lastName: userInfo?.last_name || '',
        phoneNumber: userInfo?.phone_number || '',
        address: userInfo?.address || '',
        emailConfirmed: !!user.email_confirmed_at
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Token verification failed:', error.message);
    res.status(401).json({
      success: false,
      message: 'Invalid authentication token',
      error: error.message
    });
  }
});

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token required'
      });
    }

    const accessToken = authHeader.split('Bearer ')[1];
    
    // Get user from session
    const { data, error } = await supabaseService.client.auth.getUser(accessToken);
    
    if (error) throw error;

    const user = data.user;
    
    // Get user info from users_registered table
    const { data: userInfo, error: userError } = await supabaseService.client
      .from('users_registered')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (userError) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: userInfo.email,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name,
        phoneNumber: userInfo.phone_number,
        address: userInfo.address,
        dateRegistered: userInfo.date_registered,
        emailConfirmed: !!user.email_confirmed_at
      }
    });

  } catch (error) {
    console.error('❌ Profile fetch failed:', error.message);
    res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token required'
      });
    }

    const accessToken = authHeader.split('Bearer ')[1];
    const { firstName, lastName, phoneNumber, address } = req.body;

    // Get user from session
    const { data, error } = await supabaseService.client.auth.getUser(accessToken);
    
    if (error) throw error;

    const user = data.user;

    const updateData = {};
    
    if (firstName !== undefined) updateData.first_name = firstName;
    if (lastName !== undefined) updateData.last_name = lastName;
    if (phoneNumber !== undefined) updateData.phone_number = phoneNumber;
    if (address !== undefined) updateData.address = address;

    // Update user info in users_registered table
    const { data: updatedUser, error: updateError } = await supabaseService.client
      .from('users_registered')
      .update(updateData)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        phoneNumber: updatedUser.phone_number,
        address: updatedUser.address
      }
    });

  } catch (error) {
    console.error('❌ Profile update failed:', error.message);
    res.status(400).json({
      success: false,
      message: 'Profile update failed: ' + error.message
    });
  }
});

// Delete user account
router.delete('/account', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token required'
      });
    }

    const accessToken = authHeader.split('Bearer ')[1];
    
    // Get user from session
    const { data, error } = await supabaseService.client.auth.getUser(accessToken);
    
    if (error) throw error;

    const user = data.user;

    // Delete user profile from users_registered table
    const { error: profileError } = await supabaseService.client
      .from('users_registered')
      .delete()
      .eq('user_id', user.id);

    if (profileError) throw profileError;

    // Delete user from Auth
    const { error: authError } = await supabaseService.client.auth.admin.deleteUser(user.id);
    
    if (authError) throw authError;

    console.log(`🗑️ User account deleted: ${user.id}`);
    
    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('❌ Account deletion failed:', error.message);
    res.status(400).json({
      success: false,
      message: 'Account deletion failed: ' + error.message
    });
  }
});

// Password reset request
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log(`🔐 Password reset requested for: ${email}`);

    const { data, error } = await supabaseService.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.CLIENT_URL || 'http://localhost:3000'}/auth/reset-password`,
    });

    if (error) {
      console.error('❌ Password reset request error:', error);
      throw error;
    }

    console.log(`✅ Password reset email sent to: ${email}`);

    res.json({
      success: true,
      message: 'Password reset instructions sent to your email',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Password reset request failed:', error.message);
    res.status(400).json({
      success: false,
      message: 'Failed to send password reset email: ' + error.message
    });
  }
});

module.exports = router;