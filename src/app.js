const shell = require('shelljs')
const fs = require('fs')
const app = require('express')()
const bodyParser = require('body-parser')

const networkId = process.env.NETWORK_ID
const memberId = process.env.CORE_PEER_LOCALMSPID
const region = process.env.AWS_REGION
const key = process.env.AWS_KEY
const secret_key = process.env.AWS_SECRET_KEY
const username = process.env.CA_USERNAME
const password = process.env.CA_PASSWORD
const orderer = process.env.ORDERER_URL
const peer = process.env.CORE_PEER_ADDRESS

let caEndPoint = null

shell.cd('/home/crypto')

app.use(bodyParser.json())
app.use(cors())

async function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    shell.exec(cmd, {silent: true}, function(code, stdout, stderr) {
      if(code !== 0) {
        reject(stderr)
      } else {
        resolve(stdout)
      }
    })
  })
}

(async () => {
  try {
    shell.exec(`aws configure set aws_access_key_id ${key}`)
    shell.exec(`aws configure set aws_secret_access_key ${secret_key}`)
    shell.exec(`aws configure set region ${region}`)
    
    let output = await runCommand(`aws managedblockchain get-member --network-id ${networkId} --member-id ${memberId}`)
    output = JSON.parse(output)

    caEndPoint = output.Member.FrameworkAttributes.Fabric.CaEndpoint

    if (!fs.existsSync(`/home/crypto/admin-msp`)) {
      shell.exec(`aws s3 cp s3://us-east-1.managedblockchain/etc/managedblockchain-tls-chain.pem  /home/crypto/managedblockchain-tls-chain.pem`)
      shell.exec(`fabric-ca-client enroll -u https://${username}:${password}@${caEndPoint} --tls.certfiles /home/crypto/managedblockchain-tls-chain.pem -M /home/crypto/admin-msp`)
      shell.exec(`cp -r admin-msp/signcerts admin-msp/admincerts`)

      const configtx = `
        ################################################################################
        #
        #   Section: Organizations
        #
        #   - This section defines the different organizational identities which will
        #   be referenced later in the configuration.
        #
        ################################################################################
        Organizations:
            - &Org1
                    # DefaultOrg defines the organization which is used in the sampleconfig
                    # of the fabric.git development environment
                Name: ${memberId}
                    # ID to load the MSP definition as
                ID: ${memberId}
                MSPDir: /home/crypto/admin-msp
                    # AnchorPeers defines the location of peers which can be used
                    # for cross org gossip communication.  Note, this value is only
                    # encoded in the genesis block in the Application section context    
                AnchorPeers:    
                    - Host: 
                      Port:    

        ################################################################################
        #
        #   SECTION: Application
        #
        #   - This section defines the values to encode into a config transaction or
        #   genesis block for application related parameters
        #
        ################################################################################
        Application: &ApplicationDefaults
                # Organizations is the list of orgs which are defined as participants on
                # the application side of the network
            Organizations:

        ################################################################################
        #
        #   Profile
        #
        #   - Different configuration profiles may be encoded here to be specified
        #   as parameters to the configtxgen tool
        #
        ################################################################################
        Profiles:
            OneOrgChannel:
                Consortium: AWSSystemConsortium
                Application:
                    <<: *ApplicationDefaults
                    Organizations:
                        - *Org1
      `

      fs.writeFileSync('./configtx.yaml', configtx)
    }
  } catch(e) {
    console.log(e)
    process.exit();
  }
})()

app.post('/vote', async (req, res) => {
  let signature = req.body.signature
  let president = req.body.president
  let userId = req.body.userId

  president = Buffer.from(president).toString('base64')

  try {
    await runCommand(`peer chaincode invoke -n voting -c '{"Args":["vote", "${userId}", "identity", "${signature}"]}' --transient "{\\"to\\":\\"${president}\\"}" -C voting -o $ORDERER_URL --cafile /home/crypto/managedblockchain-tls-chain.pem --tls`)
    res.send({message: "Voted"})
  } catch(e) {
    console.log(e)
    res.send({message: e, error: true})
  }
})

app.get('/getVotes', async (req, res) => {
  let president = req.query.president

  try {
    let votes = await runCommand(`peer chaincode query -n voting -c '{"Args":["getVotes","${president}"]}' -C voting --cafile /home/crypto/managedblockchain-tls-chain.pem --tls`)
    res.send({message: votes.slice(0, -1)})
  } catch(e) {
    res.send({message: e, error: true})
  }
})

app.listen(3000, () => console.log('API Server Running'))
