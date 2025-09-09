const express=require("express")
const router=express.Router();
const controller = require('./controller');
const authMiddleware = require('../Middleware/authentication');

router.post('/signup',controller.signup)
router.post('/signin',controller.signin)
router.get('/delete',authMiddleware,controller.deleteaccount)

module.exports=router;