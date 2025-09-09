const jwt=require('jsonwebtoken')
const bcrypt=require('bcrypt')
const users=[]
const SECRET_KEY="itachi"

const signup=async(req,res,next)=>{
    const {username,password}=req.body;

    if (users.find(u => u.username === username)) {
        return res.status(400).json({ message: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, password: hashedPassword });
    res.status(200).json("succusfully sign upped ")
}


const signin=async(req,res,next)=>{
    const {username,password}=req.body;
    const user=users.find(u=>u.username===username)
    if(!user){
        res.json("no user of such name")
    }
    const correctpassword = await bcrypt.compare(password, user.password);

    if(!correctpassword){
        res.json("chor,chor")
    }

    const token=jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: '1h' })
    res.json({message:"verifid",token})

}
const deleteaccount = (req, res, next) => {
    try {
        
        const username = req.user.username;

        
        const index = users.findIndex(u => u.username === username);
        if (index === -1) {
            return res.status(404).json({ message: "User not found" });
        }

        users.splice(index, 1);

        res.status(200).json({ message: "User deleted successfully" });
    } catch (err) {
        next(err); 
    }
};
module.exports={signin,signup,deleteaccount}
