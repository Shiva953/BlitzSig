// creating a k/3rd squads multi-sig

import {
    ActionPostResponse,
    ACTIONS_CORS_HEADERS,
    createPostResponse,
    ActionGetResponse,
    ActionPostRequest,
  } from "@solana/actions";
  import {
    clusterApiUrl,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
  } from "@solana/web3.js";
  import * as multisig from '../../../../../node_modules/@sqds/multisig';

  export const GET = async (req: Request) => {
    try {
      const requestUrl = new URL(req.url);
  
      const payload: ActionGetResponse = {
        title: "BlitzSig",
        icon: new URL("https://avatars.githubusercontent.com/u/84348534?v=4", requestUrl.origin).toString(),
        description: "Create a squad directly from a blink",
        label: "Squads",
        links: {
          actions: [
            {
              label: "Create a New Squad",
              href: `/api/actions/squads?member1={w1}&member2={w2}&member3={w3}&threshold={threshold}`, // this href will have a text input
              parameters: [
                {
                  name: "w1", 
                  label: "Wallet Address 1",
                  required: true,
                },
                {
                    name: "w2", 
                    label: "Wallet Address 2", 
                    required: true,
                },
                {
                    name: "w3", 
                    label: "Wallet Address 3", 
                    required: true,
                },
                {
                    name: "threshold", 
                    label: "Set the threshold(1|2|3)", 
                    required: true,
                },
              ],
            },
          ],
        },
      };
  
      return Response.json(payload, {
        headers: ACTIONS_CORS_HEADERS,
      });
    } catch (err) {
      console.log(err);
      let message = "An unknown error occurred";
      if (typeof err == "string") message = err;
      return new Response(JSON.stringify(message), {
        status: 400,
        headers: ACTIONS_CORS_HEADERS,
      });
    }
  };
  
  // actions server returns a base64 encoded TXN, which shall be signed by the user on the client side with his wallet
  export const POST = async (req: Request) => {
    try {
      const requestUrl = new URL(req.url);
      const { member1, member2, member3, threshold } = validatedQueryParams(requestUrl); //decoding query params

      if(threshold<1 || threshold>3) {
        return new Response(JSON.stringify({
          message: 'Invalid threshold provided, should be 1|2|3'
        }), {
          status: 400,
          headers: ACTIONS_CORS_HEADERS,
        });
      }
      const body: ActionPostRequest = await req.json(); //the POST request body
  
      const connection = new Connection(
        process.env.SOLANA_RPC! || clusterApiUrl("mainnet-beta"), "confirmed"
      );

      const createKey = Keypair.generate();

      let creatorAccount: PublicKey;
      try {
        creatorAccount = new PublicKey(body.account);
      } catch (err) {
        return new Response(JSON.stringify('Invalid "account" provided'), {
          status: 400,
          headers: ACTIONS_CORS_HEADERS,
        });
      }

      // Deriving the multisig PDA from the createKey
      const multisigPda = multisig.getMultisigPda({
        // The createKey has to be a Public Key, see accounts reference for more info
        createKey: createKey.publicKey,
    })[0];

    // the treasury
      const programConfigPda = multisig.getProgramConfigPda({})[0];
      const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
          connection,
          programConfigPda
        );
      const configTreasury = programConfig.treasury;

      // new squad creation txn
      const transaction = new Transaction();
      const { Permission, Permissions } = multisig.types;

      const ixn = multisig.instructions.multisigCreateV2({
        treasury: configTreasury,
        creator: creatorAccount,
        multisigPda: multisigPda,
        configAuthority: null,
        threshold: threshold,
        members: [{
           key: member1!,
           permissions: Permissions.all(),
          },
          {
            key: member2!,
            permissions: Permissions.all(),
          },
          {
            key: member3!,
            permissions: Permissions.all(),
            }],
            timeLock: 0,
            createKey: createKey.publicKey,
            rentCollector: null,
      })
      
      const [vault] = multisig.getVaultPda({
        multisigPda,
        index: 0,
      });

      //TXN FOR MULTISIG ACCOUNT CREATION
      transaction.add(ixn);
      //ALSO INITIATING THE VAULT ACCOUNT
      transaction.add(SystemProgram.transfer({
        fromPubkey: creatorAccount,
        toPubkey: vault,
        lamports: 0.001 * LAMPORTS_PER_SOL
      }));
      transaction.feePayer = creatorAccount;
      transaction.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;

      transaction.partialSign(createKey);

      //squads vault account
      
      const payload: ActionPostResponse = await createPostResponse({
        fields: {
          transaction,
          message: `Squads Vault Address: ${vault.toString()} \n Multisig Address: ${multisigPda.toString()}`,
        },
      }); 
  
      return Response.json(payload, {
        headers: ACTIONS_CORS_HEADERS,
      });
    } catch (err) {
        console.log(err);
        let message = "An unknown error occurred";
        if (typeof err == "string") message = err;
        return new Response(JSON.stringify(message), {
            status: 400,
            headers: ACTIONS_CORS_HEADERS,
        });
    }
  };

  // DO NOT FORGET TO INCLUDE THE `OPTIONS` HTTP METHOD
  // THIS WILL ENSURE CORS WORKS FOR BLINKS
  export const OPTIONS = async (req: Request) => {
    return new Response(null, {
      status: 204,
      headers: ACTIONS_CORS_HEADERS,
    });
  };

  function validatedQueryParams(requestUrl: URL) {
    let member1, member2, member3;
    let threshold = 2;
    try {
      if (requestUrl.searchParams.get("member1") && requestUrl.searchParams.get("member2") && requestUrl.searchParams.get("member3")) {
        member1 = new PublicKey(requestUrl.searchParams.get("member1")!);
        member2 = new PublicKey(requestUrl.searchParams.get("member2")!);
        member3 = new PublicKey(requestUrl.searchParams.get("member3")!);
      }
    } catch (err) {
      throw "Invalid input query parameters";
    }
  // const sq = Squads.mainnet();
  // const tx = await sq;
    try {
      if (requestUrl.searchParams.get("threshold")) {
        threshold = parseInt(requestUrl.searchParams.get("threshold")!);
      }
    } catch (err) {
      throw "Invalid input query parameter";
    }
  
    return { member1, member2, member3, threshold };
  }