import React, { FC } from 'react'
import Typography from '@material-ui/core/Typography'
import { BigNumber } from 'ethers'
import { makeStyles } from '@material-ui/core/styles'
import DetailRow from 'src/components/DetailRow'
import { commafy } from 'src/utils'

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.padding.extraLight,
    width: '32.0rem'
  },
  text: {
    paddingBottom: theme.padding.extraLight,
  }
}))

type Props = {
  bonderFee: string | undefined
  destinationTxFee: string | undefined
}

const FeeDetails: FC<Props> = props => {
  const styles = useStyles()
  const {
    bonderFee,
    destinationTxFee
  } = props

  return (
    <div className={styles.root}>
      <Typography variant="body1" className={styles.text}>
        The total fee covers the bonder fee and the destination transaction cost paid by the Bonder.
      </Typography>
      <Typography variant="body1" className={styles.text}>
      On Optimism and Arbitrum the destination tx fee fluctuates with L1 gas price.
      </Typography>
      <Typography variant="body1" className={styles.text}>
      LP fees are included in the swap price.
      </Typography>
      <DetailRow
        title="Bonder fee"
        value={bonderFee}
        contrastText
      />
      <DetailRow
        title="Destination tx cost"
        value={destinationTxFee}
        contrastText
      />
    </div>
  )
}

export default FeeDetails
